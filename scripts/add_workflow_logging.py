#!/usr/bin/env python3
"""Add workflow_events logging nodes to real estate n8n workflow JSONs.

Inserts two Postgres nodes per workflow:
  - Log Triggered: fires right after the auth gate (Token Check / Token Found?)
  - Log Completed: fires after the terminal action node(s)

Both nodes use continueOnFail=true so a DB outage never breaks the live workflow.
"""

import json
import os

WORKFLOW_DIR = os.path.join(os.path.dirname(__file__), "..", "n8n", "workflows")
NORRAI_INTERNAL = "e2f9934c-4d28-4bb4-ac90-4284c1123517"
NEON_CRED = {"id": "NEON_CREDENTIAL_ID", "name": "Neon account"}

# Per-workflow configuration
CONFIGS = [
    {
        "file": "Real Estate Instant Lead Response.json",
        "workflow_name": "instant_lead_response",
        "token_node": "Token Check",
        "after_token": "Validate Input",
        "terminal_nodes": ["Email Preview to Agent"],
        "webhook_node": "Receive Lead",
        "has_agent_email": True,
        "triggered_id": "aabb0001-0001-4000-8000-000000000001",
        "completed_id": "aabb0001-0002-4000-8000-000000000002",
    },
    {
        "file": "Real Estate Open House Setup.json",
        "workflow_name": "open_house_setup",
        "token_node": "Token Check",
        "after_token": "Prep Fields",
        "terminal_nodes": ["Email QR to Agent"],
        "webhook_node": "Receive Setup",
        "has_agent_email": True,
        "triggered_id": "aabb0002-0001-4000-8000-000000000001",
        "completed_id": "aabb0002-0002-4000-8000-000000000002",
    },
    {
        "file": "Real Estate Listing Description Generator.json",
        "workflow_name": "listing_description",
        "token_node": "Token Check",
        "after_token": "Valid Email Check",
        "terminal_nodes": ["Send email"],
        "webhook_node": "Get Listing Details",
        "has_agent_email": True,
        "triggered_id": "aabb0003-0001-4000-8000-000000000001",
        "completed_id": "aabb0003-0002-4000-8000-000000000002",
    },
    {
        # Attendee sign-in form — no agent_email in payload; use norrai_internal
        "file": "Real Estate Open House Follow-Up.json",
        "workflow_name": "open_house_follow_up",
        "token_node": "Token Check",
        "after_token": "Prep Wait Time",
        "terminal_nodes": ["SMS to Attendee"],
        "webhook_node": None,
        "has_agent_email": False,
        "triggered_id": "aabb0004-0001-4000-8000-000000000001",
        "completed_id": "aabb0004-0002-4000-8000-000000000002",
    },
    {
        "file": "Real Estate 7-Touch Cold Nurture.json",
        "workflow_name": "cold_nurture",
        "token_node": "Token Check",
        "after_token": "Prep Fields",
        "terminal_nodes": ["SMS T6"],
        "webhook_node": "Manual Enrollment",
        "has_agent_email": True,
        "triggered_id": "aabb0005-0001-4000-8000-000000000001",
        "completed_id": "aabb0005-0002-4000-8000-000000000002",
    },
    {
        # Send SMS always fires; Log Completed fans out from it alongside Has Email?
        "file": "Real Estate Review Request.json",
        "workflow_name": "review_request",
        "token_node": "Token Check",
        "after_token": "Prep Fields",
        "terminal_nodes": ["Send SMS"],
        "webhook_node": "Receive Review Request",
        "has_agent_email": True,
        "triggered_id": "aabb0006-0001-4000-8000-000000000001",
        "completed_id": "aabb0006-0002-4000-8000-000000000002",
    },
    {
        # Token-based auth, no agent_email; two terminal paths both connect to Log Completed
        "file": "Real Estate Lead Cleanser.json",
        "workflow_name": "lead_cleanser",
        "token_node": "Token Found?",
        "after_token": "Build Dedupe Query",
        "terminal_nodes": ["Update Existing Lead", "Trigger Lead Response"],
        "webhook_node": None,
        "has_agent_email": False,
        "triggered_id": "aabb0007-0001-4000-8000-000000000001",
        "completed_id": "aabb0007-0002-4000-8000-000000000002",
    },
]


def client_id_expr_triggered(webhook_node):
    """SQL fragment for client_id in the Log Triggered INSERT."""
    return (
        f"COALESCE(\n"
        f"    (SELECT id FROM clients\n"
        f"     WHERE primary_contact_email = '{{{{ $json.body.agent_email }}}}'\n"
        f"     LIMIT 1),\n"
        f"    '{NORRAI_INTERNAL}'::uuid\n"
        f"  )"
    )


def client_id_expr_completed(webhook_node):
    """SQL fragment for client_id in the Log Completed INSERT, using a fixed node ref."""
    return (
        f"COALESCE(\n"
        f"    (SELECT id FROM clients\n"
        f"     WHERE primary_contact_email = '{{{{ $node[\"{webhook_node}\"].json.body.agent_email }}}}'\n"
        f"     LIMIT 1),\n"
        f"    '{NORRAI_INTERNAL}'::uuid\n"
        f"  )"
    )


def build_triggered_sql(workflow_name, webhook_node, has_agent_email):
    client = client_id_expr_triggered(webhook_node) if has_agent_email else f"'{NORRAI_INTERNAL}'::uuid"
    return (
        f"INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)\n"
        f"VALUES (\n"
        f"  {client},\n"
        f"  '{workflow_name}',\n"
        f"  'triggered',\n"
        f"  jsonb_build_object('execution_id', '{{{{ $execution.id }}}}')\n"
        f")"
    )


def build_completed_sql(workflow_name, webhook_node, has_agent_email):
    client = client_id_expr_completed(webhook_node) if has_agent_email else f"'{NORRAI_INTERNAL}'::uuid"
    return (
        f"INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)\n"
        f"VALUES (\n"
        f"  {client},\n"
        f"  '{workflow_name}',\n"
        f"  'completed',\n"
        f"  jsonb_build_object('execution_id', '{{{{ $execution.id }}}}')\n"
        f")"
    )


def make_pg_node(node_id, name, query, position):
    return {
        "parameters": {
            "operation": "executeQuery",
            "query": query,
        },
        "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.5,
        "position": position,
        "id": node_id,
        "name": name,
        "continueOnFail": True,
        "credentials": {"postgres": NEON_CRED},
    }


def process_workflow(config):
    filepath = os.path.join(WORKFLOW_DIR, config["file"])
    with open(filepath) as f:
        data = json.load(f)

    nodes = data["nodes"]
    connections = data["connections"]

    # Sanity check: skip if already has logging nodes
    existing_names = {n["name"] for n in nodes}
    if "Log Triggered" in existing_names or "Log Completed" in existing_names:
        print(f"  skip (already has logging): {config['file']}")
        return

    # Find token node position
    token_node = next(n for n in nodes if n["name"] == config["token_node"])
    token_pos = token_node["position"]

    # Find terminal node positions
    terminal_node_objs = [
        next(n for n in nodes if n["name"] == name)
        for name in config["terminal_nodes"]
    ]
    max_x = max(n["position"][0] for n in terminal_node_objs)
    avg_y = sum(n["position"][1] for n in terminal_node_objs) // len(terminal_node_objs)

    # Build SQL
    triggered_sql = build_triggered_sql(
        config["workflow_name"], config.get("webhook_node"), config["has_agent_email"]
    )
    completed_sql = build_completed_sql(
        config["workflow_name"], config.get("webhook_node"), config["has_agent_email"]
    )

    # Create nodes — Log Triggered sits below the token gate, Log Completed at the end
    log_trig_pos = [token_pos[0], token_pos[1] + 260]
    log_comp_pos = [max_x + 220, avg_y]

    log_triggered = make_pg_node(config["triggered_id"], "Log Triggered", triggered_sql, log_trig_pos)
    log_completed = make_pg_node(config["completed_id"], "Log Completed", completed_sql, log_comp_pos)

    nodes.append(log_triggered)
    nodes.append(log_completed)

    # --- Rewire connections ---

    # 1. token_node[0] → Log Triggered  (was: token_node[0] → after_token)
    token_conns = connections.setdefault(config["token_node"], {})
    main = token_conns.setdefault("main", [[]])
    true_branch = main[0] if main else []
    true_branch = [t for t in true_branch if t["node"] != config["after_token"]]
    true_branch.append({"node": "Log Triggered", "type": "main", "index": 0})
    main[0] = true_branch
    token_conns["main"] = main

    # 2. Log Triggered → after_token
    connections["Log Triggered"] = {
        "main": [[{"node": config["after_token"], "type": "main", "index": 0}]]
    }

    # 3. Each terminal node fans out to Log Completed (alongside any existing targets)
    for term_name in config["terminal_nodes"]:
        term_conns = connections.setdefault(term_name, {})
        term_main = term_conns.setdefault("main", [[]])
        if not term_main:
            term_main = [[]]
        if not term_main[0]:
            term_main[0] = []
        term_main[0].append({"node": "Log Completed", "type": "main", "index": 0})
        term_conns["main"] = term_main

    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"  ✓ {config['file']}")


if __name__ == "__main__":
    print("Adding workflow_events logging nodes...")
    for config in CONFIGS:
        process_workflow(config)
    print("Done.")
