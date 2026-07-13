# Spec 07 — `/new-workflow`: compliant workflow scaffold generator

## Problem

Every workflow build hand-recreates the same skeleton — Webhook, Token Check with a 401 false branch, Sanitize Input, Lookup Client, Log Triggered/Completed, Error Workflow setting, registry entries — and misses recur (Manual Opt-Out Handler shipped without Log Triggered on 06-07; several workflows were never registered in the Error Logger map; the model-id-hardcoded-everywhere problem grows with each new workflow).

## Goal

`python3 scripts/new_workflow.py --name "..." --webhook-path ... [flags]` emits a lint-clean, logging-standard-compliant workflow JSON plus the exact registry lines to paste, so a build session starts from a correct skeleton instead of a blank canvas.

## Deliverables

1. `scripts/new_workflow.py` (stdlib only).
2. `.claude/skills/new-workflow/SKILL.md` + `.claude/commands/new-workflow.md` stub.

## CLI

```
--name "Real Estate Foo Handler"      required — n8n display name
--workflow-name foo_handler           required — snake_case registry key
--trigger webhook|cron                default webhook
--webhook-path foo-handler            required when trigger=webhook
--method POST|GET                     default POST
--cron "0 13 * * 1"                   required when trigger=cron (UTC; note CT conversion in a comment)
--client lookup|internal|bnb          default internal
--claude                              include a Claude call block (Model Config + Build Prompt + HTTP + Parse)
--out n8n/workflows/                  default; writes "<name>.json"
```

## Generated skeleton (trigger=webhook, --client lookup --claude)

Node chain (positions auto-spaced 220px apart; all Postgres nodes use the standard Neon credential *name* placeholder `"Postgres account"` — match whatever name existing exports use; check one before hardcoding):

```
Webhook (path, method, responseMode: responseNode)
→ Token Check (IF: {{ $json.headers['x-norr-token'] }} equals plain-string placeholder NORR_TOKEN_PLACEHOLDER)
   ├─ false → Respond Unauthorized (respondToWebhook, responseCode 401, respondWith json, {"error":"unauthorized"})
   └─ true → Sanitize Input (Code: escape quotes .replace(/'/g,"''") on every expected string field,
              parseFloat numerics, output flat object — fields stubbed with TODO comments)
→ Lookup Client (per --client:
     lookup:   Postgres SELECT id FROM clients WHERE primary_contact_email = '{{ $json.agent_email }}',
               continueOnFail true, alwaysOutputData true
     internal: Code node returning {id: 'e2f9934c-4d28-4bb4-ac90-4284c1123517'}  // norrai_internal
     bnb:      Code node returning {id: '86a01b94-ddab-4594-8afc-8212fb18fdd0'})
→ Log Triggered (Postgres, continueOnFail true, query prefixed with '=':
     INSERT INTO workflow_events (client_id, workflow_name, event_type, payload)
     VALUES ('{{ $('Lookup Client').first().json.id }}', '<workflow_name>', 'triggered',
       '{"execution_id": "{{ $execution.id }}"}'::jsonb))
→ [--claude only] Model Config (Set node: model_sonnet = claude-sonnet-5 (verify current id in
     scripts/models_allowed.json), model_haiku = claude-haiku-4-5-20251001)
→ [--claude only] Build Prompt (Set node, single `prompt` field, multiline TODO template with
     [DATA]{{ $('Sanitize Input').first().json.field }}[/DATA] delimiters)
→ [--claude only] Claude API (HTTP POST https://api.anthropic.com/v1/messages,
     specifyBody json, jsonBody "={{ { model: $('Model Config').first().json.model_sonnet,
     max_tokens: 1024, messages: [{role:'user', content: $('Build Prompt').first().json.prompt}] } }}",
     headers anthropic-version, retryOnFail true, maxTries 3, waitBetweenTries 5000,
     credential placeholder "Anthropic API")
→ [--claude only] Parse Response (Code: strip markdown fences before JSON.parse — fence-stripping
     lesson — with TODO for output shape)
→ TODO: YOUR LOGIC HERE (a disconnected NoOp node named "TODO Build Here" is NOT included —
     instead the chain wires straight through and the Parse/Sanitize node carries a TODO comment)
→ Log Completed (Postgres, continueOnFail true, event_type 'completed', same client ref pattern)
→ Respond Success (respondToWebhook, respondWith json, responseBody {"status":"ok"})
```

For `--trigger cron`: Schedule Trigger replaces Webhook, no Token Check/Respond nodes; chain is Schedule → Lookup Client → Log Triggered → ... → Log Completed.

Workflow `settings`: `{"executionOrder": "v1", "errorWorkflow": "NORR_ERROR_LOGGER_ID_PLACEHOLDER", "timezone": "America/Chicago"}` — plus a top comment in the script explaining: on import, re-select the Error Workflow in Settings (ids differ per instance).

Hard rules baked into the template (these are the lint rules from Spec 02 — the generator must emit code that passes its own lint):

- Every Postgres query containing `{{` starts with `=`.
- Logging/lookup nodes: `onError: "continueRegularOutput"` (JSON representation of continueOnFail).
- No send nodes are generated (sends are workflow-specific), but the SKILL.md includes the proven SendGrid block (from `Weekly Marketing Drip - Send.json` `Send Email`) as a copy-paste snippet with a bold "never continueOnFail on this node" warning.
- All cross-node references use `$('Node Name').first().json.*`, never bare `$json` after a Postgres/HTTP node.

### Script output (stdout, after writing the file)

```
Wrote n8n/workflows/Real Estate Foo Handler.json  (12 nodes)

NEXT STEPS (do all of these):
1. Registry — add to n8n/README.md table:
   | Real Estate Foo Handler | `foo_handler` |
2. Error Logger — add to WORKFLOW_NAME_MAP in 'Norr AI Workflow Error Logger.json'
   (Extract Error Data node):  'Real Estate Foo Handler': 'foo_handler',
3. Replace NORR_TOKEN_PLACEHOLDER thinking about Token Check (plain string, NO '=' prefix).
4. Import into n8n via REST POST /api/v1/workflows (create persists params; PUT may not),
   transfer to Norr AI project dHMe2aoOwTztDaWE, wire credentials in the UI.
5. Set Settings → Error Workflow → 'Norr AI Workflow Error Logger'.
6. Run: python3 scripts/n8n_lint.py "n8n/workflows/Real Estate Foo Handler.json"
```

The script validates its own output: after writing, it re-reads with strict `json.loads` and, if `scripts/n8n_lint.py` exists, invokes it and fails loudly on any ERROR.

### SKILL.md content

- When to use: at the START of any new-workflow build, before designing custom logic.
- The command line + flag table.
- After generating: the skill instructs Claude to do steps 1–2 of the NEXT STEPS itself (edit the two registries), leave 3–5 for the import phase, and hand the skeleton to the build.
- The SendGrid and Twilio copy-paste blocks with their gotchas inline.

## Acceptance criteria

- `python3 scripts/new_workflow.py --name "ZZ Scaffold Test" --workflow-name zz_scaffold_test --webhook-path zz-scaffold-test --client internal --claude` writes a file that (a) strict-parses, (b) passes `n8n_lint.py` with 0 ERRORs, (c) imports into n8n without "invalid JSON" or validation complaints, (d) `/n8n-audit` marks it compliant except the placeholder items. Delete the test file + live import afterwards.
- Generated `connections` are correct: Token Check output 0 (true) → Sanitize Input, output 1 (false) → Respond Unauthorized. (n8n IF: main[0]=true, main[1]=false.)
- Cron variant generates without webhook/token/respond nodes and no orphan connections.

## Non-goals

- Not a general n8n templating system — exactly this project's standard skeleton, nothing configurable beyond the flags above.
