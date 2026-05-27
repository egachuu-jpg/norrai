# Lessons Learned

## n8n — Expressions & Nodes
- Token Check rightValue must be a plain string — any `=` prefix causes n8n to evaluate it as an expression and the check always fails
- Never use `$json.caller` (or similar dynamic fields) in SQL nodes — n8n blocks certain variable references in database queries for security; use hardcoded strings or safe payload fields
- Cache Lookup (Postgres) node: enable "Always Output Data" or the node stops execution on 0 rows instead of passing through
- Any Postgres SELECT used as a conditional check (dedup, existence, lookup) must have `alwaysReturnData: true` in options — without it, 0-row results silently kill the execution path instead of flowing to the downstream IF node
- After any node that overwrites `$json` (Postgres query, HTTP Request, Code node), upstream data is gone from `$json` — always reference the original source node by name: `$('Node Name').item.json.field` instead of `$json.field`
- Code nodes use the n8n JS API directly — `$('Node Name').item.json` with no `{{ }}` wrapper. The `{{ }}` expression syntax is only for non-code fields (Set assignments, IF conditions, HTTP body strings, etc). Mixing them causes SyntaxError: Unexpected identifier
- n8n Split In Batches: output 0 = done (fires when all items processed), output 1 = loop (fires for each item) — the reverse of what you'd expect
- n8n Switch node `fallbackOutput: 'extra'` does NOT wire through the connections array — the fallback port is unconnected even with a 6th entry in `main[]`. Always add an explicit named rule for every expected category (including the catch-all) instead of relying on the fallback output
- Multiline Claude prompts: build in a Set node first, pass as `$json.prompt` to the HTTP Request — avoids bad control character errors from inline expressions
- Watch for field name mismatches between HTML form payload keys and n8n node references — silent failures with no error output
- Double `$$` on price fields in n8n expressions is a known gotcha — check expressions on any currency field
- When `continueOnFail: true` is set on an HTTP Request node, `$input.first().json` in the downstream Code node is the n8n error object on failure — always use `$('NodeName').first().json` for a stable upstream named ref to preserve payload data regardless of HTTP result
- `respondToWebhook` node with empty `options: {}` returns `{"success": true}` — always set `respondWith: "firstIncomingItem"` (for passthrough) or `"json"` with an explicit `responseBody` expression
- `toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })` includes the year in Node.js even if you omit the `year` option — use the `toLocaleString` + split pattern instead: `new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false }).split(', ')[0]` then split on `/` for month/day
- After removing a node from a workflow JSON array, check the previous node for a trailing comma — JSON is invalid with it and n8n will refuse to import
- For confirm/accept workflows triggered by link clicks (GET requests), read the token from `$json.query.token` (query param), not from a request header
- Validate UUIDs with regex before using them in SQL — untrusted URL params may be malformed or injection attempts; use `SELECT null::uuid WHERE false` as a safe no-op fallback
- Idempotency in confirm workflows: check `IS NULL` on the timestamp column before updating to prevent double-enrollment on repeated link clicks
- Parallel fire-and-forget in n8n: multiple downstream nodes can fan out from the same output — add them both to the same `connections["Source Node"]["main"][0]` array in the JSON
- After a parallel fan-out (e.g., Send to Lead → [Update Lead Record, Send Agent Copy]), `$json` in each downstream node is that node's own input — the HTTP response from the fork source, not the lead data; use `$('UpstreamNodeName').first().json.*` for all fields
- `{{ JSON.stringify($json.field) }}}` triple-brace in jsonBody causes n8n parse errors — use `"{{ $json.field }}"` (quoted expression) for simple string fields that don't need JSON encoding
- Neon SQL UUID quoting: always wrap UUID expressions in single quotes inside SQL strings — `'{{ $json.id }}'`, not `{{ $json.id }}`; bare UUID causes "invalid input syntax for type uuid" error
- `NULLIF('{{ $json.body.field }}', '')` is not sufficient — when n8n can't resolve the expression it renders the literal string `"undefined"`, which passes `NULLIF` and hits CHECK constraints; always use `NULLIF(NULLIF('{{ $json.body.field }}', ''), 'undefined')` in Postgres nodes
- Any user-supplied text field (sender name, subject, body snippet) can contain apostrophes that break raw SQL string interpolation — always add a Sanitize Code node before any Postgres INSERT that takes external text, running `.replace(/'/g, "''")` on each field
- Dynamic client lookup from BoldTrail/Zapier payload: read `agentemail` from Zapier trigger, sanitize with `.replace(/'/g, "''")`, query `clients` table by `primary_contact_email` to get `id` and `token` — eliminates hardcoded placeholder tokens
- Error Trigger payload fields: `$json.execution.lastNodeExecuted`, `$json.execution.error.message`, and `$json.execution.url` are available in error workflows — log all three or the dashboard can only show that something failed, not where or why
- The Error Trigger node always displays n8n's hardcoded example payload in the editor (id: 231, "Example Error Message", "Example Workflow") regardless of what actually ran — to see real error data, open the execution in the Executions tab and check the downstream node (e.g., Extract Error Data) output, not the Error Trigger node itself
- `json_build_object()` in Postgres SQL is safer than embedding arbitrary text in jsonb string literals — handles quotes and special characters without manual escaping
- `onError: "continueRegularOutput"` is the JSON-export representation of `continueOnFail: true` — use this in workflow JSON files, not `"continueOnFail": true` at the node level
- After a Postgres node, `$json` is the Postgres result — always reference the upstream Code node by name (`$('NodeName').first().json`) when building downstream expressions that need data from before the DB call
- For read-heavy dashboard endpoints, a single Postgres query using nested `json_build_object()` with correlated subqueries returns fully nested JSON in one round trip — no downstream Code node assembly required
- Token Check false branch must have a Respond Unauthorized node (401) — a dead-end false branch leaves HTTP connections hanging indefinitely
- Upsert with CTE: `WITH existing AS (SELECT id FROM t WHERE ...), inserted AS (INSERT INTO t ... WHERE NOT EXISTS (SELECT 1 FROM existing) RETURNING id) SELECT COALESCE((SELECT id FROM existing), (SELECT id FROM inserted))` — single round-trip that returns id regardless of insert vs. existing
- Sanitize Input Code node between Token Check and Postgres is the right place to escape single quotes (`.replace(/'/g, "''")`), cast numerics with `parseFloat()`, and output a flat clean object; downstream nodes reference it by name, not `$json`

## n8n — Workflow Management
- After editing a workflow JSON file locally, re-import is required in n8n — it does not auto-sync from the file
- When restructuring HTML file paths (e.g., into subfolders), n8n workflow webhook URLs are unaffected — only Playwright test file paths need updating
- "With Research" workflow variants use distinct webhook paths (e.g., `lead-response-research`) so originals and new variants coexist in n8n during smoke testing — swap to original paths when promoting to production
- Email-only demo variants are a useful pattern when Twilio is not provisioned — swap SMS nodes for SendGrid, update prompts to SUBJECT/BODY format, use a distinct webhook path
- When A2P registration is pending, hardcode `channel: 'email'` in Prep Fields and replace Twilio nodes with SendGrid — restore to SMS by changing one field + adding IF gates per touch; scattering the channel decision across multiple nodes makes it hard to restore later
- `if (beds || baths)` evaluates `0` as falsy even after `|| ''` initialization — when a numeric field could legitimately be zero, use `if (beds !== '' || baths !== '')` for the explicit empty-string check
- Gmail node returns email headers with initial caps: `From` and `Subject` (not `from`/`subject`) — accessing lowercase field names silently returns `undefined`
- Multiple nurture variants exist (standard, email-only, slack-preview, with-research) each with their own webhook path — always verify form `WEBHOOK_URL` and confirm workflow `Fire Nurture Enrollment` URL both point to the intended variant; mismatches are silent
- The email-only nurture variant (`nurture-enroll-email-only`) has the research agent built in; the standard variant (`nurture-enroll`) does not — they differ in more than just SMS vs. email
- When `lead_id` is not in the enrollment payload (manual form submissions never include it), set `nurture_enrolled_at` by matching on `email` with `continueOnFail: true` — silently no-ops if the lead isn't in Neon yet
- Two active n8n webhooks cannot share the same path — the later-imported one takes over; client-variant workflows must use distinct paths (e.g., `weichert-open-house-signin` vs. `open-house-signin`)
- Mid-sequence enrollment check without `lead_id` in payload: look up `leads.status` by joining `leads.email` + `clients.primary_contact_email` — the email+agent pair uniquely identifies the enrollment when `lead_id` is not threaded through the sequence

## SendGrid
- HTML email arriving as a Gmail attachment = unescaped `&` in HTML attribute values inside the email body; fix with `&amp;`
- Use HTTP Request node calling SendGrid v3 API directly for HTML emails — the native n8n SendGrid node doesn't set content-type correctly for HTML
- SendGrid v3 HTTP Request requires a "Header Auth" credential: `Authorization: Bearer SG.xxx`; JSON.stringify the body value
- Disable click tracking on transactional emails — enabled by default, causes Gmail to route to Promotions tab

## Gemini
- `gemini-2.0-flash` is no longer available to new API users — use `gemini-2.5-flash`
- Gemini 2.5 tool name: `google_search` (not `google_search_retrieval` — that was 2.0 only)
- REST generation config key is `generation_config` (snake_case), not `generationConfig` (JS SDK style)
- `response_mime_type: application/json` is incompatible with tool use — remove it from `generation_config` when using `google_search`
- n8n credential for Gemini: Query Auth type, field name `key`, display name "Gemini API Key"
- Gemini (and Claude) may return markdown-fenced JSON (triple-backtick json blocks) even when instructed not to — always strip fences before JSON.parse()
- Never commit `.env` — `DATABASE_URL` (pooled connection string) lives there only
- `appointments` table: schema is correct, but don't build calendar scraping/normalization until a real client requires it

## Prompt Engineering
- Wrap all user-supplied fields in Claude prompts with `[DATA][/DATA]` delimiters to prevent prompt injection (lead_name, lead_message, agent_notes, etc.)
- Cold nurture and lead response prompts must explicitly say "do not invent school names, market statistics, or sold prices" until the research agent is wired in — Claude will hallucinate these without the instruction
- Claude will also invent property-specific details (yard size, mature trees, finishes) when given an address and a prompt that says "pick one specific detail" — any touch with a property-specific angle needs "only reference details you have been given; do not invent specifics you weren't told"
- Assembled context block pattern: build a `context_block` string in Prep Fields from only the fields that are actually populated, with a fallback string when all are absent — Claude gets coherent context instead of blank labeled lines, and the fallback behavior is explicit rather than implicit
- Property highlights must be extracted during Open House Setup (when the MLS description is available) and passed as a URL param — the Follow-Up workflow fires the next morning with no access to the original listing copy
- Pass structured research data as a formatted text block (`research_detail`) not just the `insight_block` summary — Claude needs school names/ratings/distances and market numbers to answer specific lead questions; the 2–3 sentence summary is too thin
- When splitting a combined address string is required, 4 separate form fields is more reliable than parsing — comma placement is not enforced by users

## Cloudflare Access
- To add a new client: Zero Trust → Access Groups → `clients` → add email — grants access to all `/clients/*` pages automatically
- `open_house.html` stays at root (public, QR code on door) — Cloudflare Access only covers `/clients/*` and `/internal/*`
- Session durations: clients group = 7 days, internal group = 1 day

## HTML / JavaScript
- When creating a new Polar Modern HTML page, start by copying the full `:root` CSS block from an existing page in the same directory — partial copies silently omit canonical tokens (e.g. `--blush`) that may be needed for components added later
- `new Date('YYYY-MM-DD')` parses as UTC midnight and displays as the prior day in US timezones — use `new Date('YYYY-MM-DDT12:00:00')` when displaying dates locally
- `escapeHtml()` is required when rendering user-supplied strings into `innerHTML` template literals — use `textContent` for plain text nodes, `escapeHtml()` when the value is embedded in HTML markup
- `btn.disabled = true` after a successful webhook response prevents double-submit — apply this to every form submit handler

## Playwright / Testing
- `npx serve` strips `.html` extension AND drops query params in clean-URL redirects — always navigate to the clean path (no `.html`) in Playwright tests when query params are needed
- `"0".trim()` is truthy — `setup_fee=0` passes a non-empty string check; add an explicit test for zero-value numeric fields to prevent silent regression if validation logic changes
- CSS-hidden radio buttons (`opacity:0; width:0; height:0`) cannot be interacted with via `page.check()` even with `force:true` — must click the visible `<span>` label using a `:has(input[value="..."])` locator
- `type="number" step="1000"` silently prevents form submission when the value is not a valid step multiple — use `step="any"` to accept any numeric value and validate range server-side

## BoldTrail / kvCORE
- Lead Dropbox API key is inbound-only — `GET /contacts` returns 401; it pushes leads into BoldTrail, not out; Zapier uses OAuth separately
- Confirmed Zapier trigger field names: `firstname`, `lastname`, `email`, `phone`, `street`, `city`, `state`, `zip`, `origin` (lead source), `is_seller`, `seller_full_address`, `seller_street`, `seller_city`, `seller_state`, `seller_zip`, `email_status`, `on_drip`, `starrating`, `leadid`; no price_range or beds exposed
- Weichert-managed instances: outbound webhook config is brokerage-controlled; agent-level accounts have no access to configure it — Zapier is the only supported outbound path
- BoldTrail sends automated listing alert emails to leads by default — Norr AI nurture should be SMS-dominant for BoldTrail clients to avoid channel overlap and differentiate value

## Zapier
- Free tier pauses Zaps after 2 weeks of inactivity — always provision Starter ($20/mo) for live clients; silent lead drops are unacceptable
- Zapier Copilot is useful for getting confirmed payload field names before wiring n8n normalization — ask it to build the Zap, then inspect the confirmed JSON to update Code node field mappings

## Notion MCP
- Fetching a Notion database returns schema + view configs but not rows — to query rows, search within the database using `data_source_url: collection://...` from the `<data-source>` tag in the fetch result
- Fetching a view URL directly (`view://...`) is not supported by the fetch tool — results in a validation error
- Notion workspace search returns the database itself as a result, not the individual rows inside it — workspace search is not a substitute for a database query

## HTML / JavaScript
- Single HTML file can serve multiple workflow variants via a `wf` URL param — QR code generator injects the param at setup time (`wf=weichert`) so no separate HTML file is needed per client; downstream webhook routing is a one-liner: `const WEBHOOK_URL = wf === 'weichert' ? '.../weichert-open-house-signin' : '.../open-house-signin'`

## Architecture Decisions
- Own the infrastructure stack (Twilio numbers, Neon, n8n) — client pays for service, Norr AI owns the stack
- Cloudflare Access is the real auth layer for agent-facing forms; Token Check is a secondary CSRF guard, not real security
- Research Agent caches by address with 7-day TTL — call once per workflow run, not per touch; the cache covers the full cold nurture run
- Dashboard health logic: red = any failures in last 7 days, yellow = no events in 7 days (silence), green = healthy
- Per-client personalized URLs use `clients.token` (uuid) — no separate `agents` table needed at solo-agent-per-client scale
- For clients on CRMs with restricted API access (e.g. Weichert/kvCORE), Zapier Starter is the right integration layer — don't try to reverse-engineer inbound-only API keys
- Mission Control uses two tables (`stories` + `tasks`) not a self-referencing single table — stories and tasks have different schemas and different dispatch semantics; mixed parent/child rows in one table make queries and routing awkward
- `seq` int on tasks enables ordered display within a story and future auto-advance logic; add it even before the automation is built
- Task `category` is the dispatch routing key: research/analysis → Claude API via n8n (fully autonomous); dev/testing → formatted prompt for Claude Code (human in loop); ops → neither
- `agent_working` is a distinct task status from `in_progress` — signals an automated process is running, prevents concurrent edits, gives the board a clear in-flight indicator
- Tasks are tracked in Neon (`stories` + `tasks` tables), not in CLAUDE.md — the Open Tasks section in CLAUDE.md is stale; always query Neon for current task state
- `stories` table status CHECK constraint accepts `active | paused | done | cancelled` — NOT `completed`; always use `done` when marking a story finished
- `leads` table has no UNIQUE constraint on `(client_id, email)` — dedupe for webhook-driven inserts requires a SELECT-then-conditional-INSERT/UPDATE pattern in a Code node, not ON CONFLICT
- Zapier free tier Zaps pause after 2 weeks of inactivity — no programmatic workaround for BoldTrail-triggered Zaps (can't synthetically fire BoldTrail events); accept the risk for active agents or pay $20/mo Starter
- For delayed-send workflows (form submit now, send on a future scheduled day), use two workflows: an intake webhook that writes to a Neon queue table + a separate scheduled workflow that reads and executes — a single workflow with a multi-day Wait node leaves executions open and is unreliable
- Per-lead SendGrid sends are required when opt-out tokens must be personalized per recipient; at 2,000+ sends switch to Marketing Campaigns API with substitution tags — run `SELECT client_id, COUNT(*) FROM leads WHERE email IS NOT NULL AND communication_opted_out != true GROUP BY client_id` before go-live to determine the right approach
- `tasks.category` has a CHECK constraint — valid values are: research, analysis, dev, testing, ops; frontend work and n8n workflow builds both map to dev
- Neon MCP `run_sql` only supports a single SQL statement per call — attempting multiple statements (semicolon-separated) raises a validation error; issue separate calls for each statement
- n8n Gmail Trigger: one OAuth credential and trigger node per workflow — two agents monitoring for the same email pattern require two separate trigger workflows; share downstream logic via a parser subworkflow
- BoldTrail PropertyBoost Facebook ad leads arrive via email from `no-reply@boldtrail.com`, subject: "New Lead Email - [Name]"; HTML body contains: lead name, phone, email, property interest, source (PropertyBoost), referrer (Facebook: LeadAd), and listing URL in the Notes field
