#!/usr/bin/env python3
"""Update n8n workflow JSONs to work with the encrypted PII schema.

Changes made:
  Lead Cleanser:
    - Build Token Query:   SELECT decrypts primary_contact_email/name via pii_decrypt()
    - Build Dedupe Query:  equality check uses email_hash / phone_hash via pii_hash()
    - Build Insert Query:  wraps lead_name / email / phone with pii_encrypt(); inserts hashes

  All 7 real estate workflows (Log Triggered + Log Completed):
    - Client lookup switches from  primary_contact_email = '...'
                                to  primary_contact_email_hash = pii_hash('...')
"""

import json
import os

WORKFLOW_DIR = os.path.join(os.path.dirname(__file__), "..", "n8n", "workflows")


# ─── Lead Cleanser Code node updates ─────────────────────────────────────────

NEW_BUILD_TOKEN_QUERY = """\
const b = $input.first().json.body;
const token = b.client_token || '';
const key = ($env.PII_ENCRYPTION_KEY || '').replace(/'/g, "''");
return [{
  json: {
    query: `SELECT id,
  pii_decrypt(primary_contact_email, '${key}') AS primary_contact_email,
  pii_decrypt(primary_contact_name,  '${key}') AS primary_contact_name
FROM clients
WHERE token = '${token.replace(/'/g, "''")}'`,
    payload: b
  }
}];\
"""

NEW_BUILD_DEDUPE_QUERY = """\
const row = $input.first().json;
const prev = $('Build Token Query').first().json.payload;
const email = (prev.email || '').replace(/'/g, "''");
const phone = (prev.phone || '').replace(/'/g, "''");
return [{
  json: {
    query: `SELECT id FROM leads
WHERE client_id = '${row.id}'
  AND (email_hash = pii_hash('${email}') OR phone_hash = pii_hash('${phone}'))
LIMIT 1`,
    client_id: row.id,
    agent_email: row.primary_contact_email,
    agent_name: row.primary_contact_name,
    payload: prev
  }
}];\
"""

NEW_BUILD_INSERT_QUERY = """\
const ctx = $('Build Dedupe Query').first().json;
const p = ctx.payload;
const key = ($env.PII_ENCRYPTION_KEY || '').replace(/'/g, "''");

const esc = v => (v || '').toString().replace(/'/g, "''");

const metadata = JSON.stringify({
  property_address: p.property_address || null,
  price_range: p.price_range || null,
  beds: p.beds || null
}).replace(/'/g, "''");

const today = new Date().toISOString().split('T')[0];

return [{
  json: {
    query: `INSERT INTO leads
  (client_id, lead_name, email, email_hash, phone, phone_hash, source, lead_message, status, metadata)
VALUES (
  '${ctx.client_id}',
  pii_encrypt('${esc(p.lead_name)}', '${key}'),
  pii_encrypt('${esc(p.email)}',     '${key}'),
  pii_hash('${esc(p.email)}'),
  pii_encrypt('${esc(p.phone)}',     '${key}'),
  pii_hash('${esc(p.phone)}'),
  '${esc(p.source)}',
  '${esc(p.lead_message)}',
  'new',
  '${metadata}'
) RETURNING id`,
    client_id: ctx.client_id,
    agent_email: ctx.agent_email,
    agent_name: ctx.agent_name,
    payload: p
  }
}];\
"""


def update_lead_cleanser():
    filepath = os.path.join(WORKFLOW_DIR, "Real Estate Lead Cleanser.json")
    with open(filepath) as f:
        data = json.load(f)

    replacements = {
        "Build Token Query":  NEW_BUILD_TOKEN_QUERY,
        "Build Dedupe Query": NEW_BUILD_DEDUPE_QUERY,
        "Build Insert Query": NEW_BUILD_INSERT_QUERY,
    }

    for node in data["nodes"]:
        if node["name"] in replacements:
            node["parameters"]["jsCode"] = replacements[node["name"]]

    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("  ✓ Real Estate Lead Cleanser.json")


# ─── Logging node query updates ───────────────────────────────────────────────

# Workflows where Log Triggered/Completed have an agent_email-based client lookup
WORKFLOWS_WITH_EMAIL_LOOKUP = [
    ("Real Estate Instant Lead Response.json", "Receive Lead"),
    ("Real Estate Open House Setup.json",      "Receive Setup"),
    ("Real Estate Listing Description Generator.json", "Get Listing Details"),
    ("Real Estate 7-Touch Cold Nurture.json",  "Manual Enrollment"),
    ("Real Estate Review Request.json",        "Receive Review Request"),
]


def make_triggered_sql_with_hash(workflow_name, has_agent_email):
    if has_agent_email:
        client_expr = (
            "COALESCE(\n"
            "    (SELECT id FROM clients\n"
            "     WHERE primary_contact_email_hash = pii_hash('{{ $json.body.agent_email }}')\n"
            "     LIMIT 1),\n"
            "    'e2f9934c-4d28-4bb4-ac90-4284c1123517'::uuid\n"
            "  )"
        )
    else:
        client_expr = "'e2f9934c-4d28-4bb4-ac90-4284c1123517'::uuid"
    return (
        f"INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)\n"
        f"VALUES (\n"
        f"  {client_expr},\n"
        f"  '{workflow_name}',\n"
        f"  'triggered',\n"
        f"  jsonb_build_object('execution_id', '{{{{ $execution.id }}}}')\n"
        f")"
    )


def make_completed_sql_with_hash(workflow_name, webhook_node, has_agent_email):
    if has_agent_email:
        client_expr = (
            "COALESCE(\n"
            f"    (SELECT id FROM clients\n"
            f"     WHERE primary_contact_email_hash = pii_hash('{{{{ $node[\"{webhook_node}\"].json.body.agent_email }}}}')\n"
            f"     LIMIT 1),\n"
            f"    'e2f9934c-4d28-4bb4-ac90-4284c1123517'::uuid\n"
            f"  )"
        )
    else:
        client_expr = "'e2f9934c-4d28-4bb4-ac90-4284c1123517'::uuid"
    return (
        f"INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)\n"
        f"VALUES (\n"
        f"  {client_expr},\n"
        f"  '{workflow_name}',\n"
        f"  'completed',\n"
        f"  jsonb_build_object('execution_id', '{{{{ $execution.id }}}}')\n"
        f")"
    )


def update_logging_nodes(filename, webhook_node):
    filepath = os.path.join(WORKFLOW_DIR, filename)
    with open(filepath) as f:
        data = json.load(f)

    # Pull workflow_name from the existing Log Triggered node's current query
    workflow_name = None
    for node in data["nodes"]:
        if node["name"] == "Log Triggered":
            # Extract workflow_name from the current SQL (between the quotes after VALUES)
            q = node["parameters"]["query"]
            for line in q.split("\n"):
                line = line.strip().strip(",")
                if line.startswith("'") and not line.startswith("'triggered'") and not line.startswith("'completed'") and "uuid" not in line and "execution" not in line and "workflow_events" not in line:
                    workflow_name = line.strip("'")
                    break
            break

    if not workflow_name:
        print(f"  WARN: could not extract workflow_name from {filename}")
        return

    has_agent_email = webhook_node is not None
    new_triggered = make_triggered_sql_with_hash(workflow_name, has_agent_email)
    new_completed = make_completed_sql_with_hash(workflow_name, webhook_node, has_agent_email)

    for node in data["nodes"]:
        if node["name"] == "Log Triggered":
            node["parameters"]["query"] = new_triggered
        elif node["name"] == "Log Completed":
            node["parameters"]["query"] = new_completed

    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"  ✓ {filename}")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Updating workflows for PII encryption schema...")

    update_lead_cleanser()

    for filename, webhook_node in WORKFLOWS_WITH_EMAIL_LOOKUP:
        update_logging_nodes(filename, webhook_node)

    # Open House Follow-Up and Lead Cleanser use norrai_internal — no email lookup
    # Their logging nodes already use the hardcoded UUID; just regenerate for consistency
    update_logging_nodes("Real Estate Open House Follow-Up.json", None)
    update_logging_nodes("Real Estate Lead Cleanser.json", None)

    print("Done.")
