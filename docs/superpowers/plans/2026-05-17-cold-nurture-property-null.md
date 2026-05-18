# Cold Nurture — Property-Null Graceful Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 7-touch cold nurture sequence handle leads with no property address gracefully, and convert SMS touches to email while A2P registration is pending.

**Architecture:** One JSON file (`Real Estate 7-Touch Cold Nurture.json`) is modified in four passes: (1) Prep Fields gains a `context_block` string and `channel` field, (2) all six `Build Prompt` nodes reference `context_block` with context-adaptive angle instructions, (3) Extract nodes for T2/T4/T6 switch from SMS to email parse pattern, (4) Twilio delivery nodes for T2/T4/T6 are replaced with SendGrid nodes.

**Tech Stack:** n8n workflow JSON, Claude API (Anthropic), SendGrid, Neon Postgres

---

## File Map

| File | Changes |
|------|---------|
| `n8n/workflows/Real Estate 7-Touch Cold Nurture.json` | All changes — Prep Fields, 6x Build Prompt nodes, 3x Extract nodes, 3x delivery nodes |

---

### Task 1: Update Prep Fields to emit `context_block` and `channel`

**Files:**
- Modify: `n8n/workflows/Real Estate 7-Touch Cold Nurture.json` — node "Prep Fields" (`id: c3d4e5f6-0004-4000-8000-000000000004`)

- [ ] **Step 1: Read the file and locate the Prep Fields node**

  Open `n8n/workflows/Real Estate 7-Touch Cold Nurture.json`. Find the node with `"name": "Prep Fields"`. Its `parameters.jsCode` is the target field.

- [ ] **Step 2: Replace the jsCode value**

  Replace the entire `jsCode` string with:

  ```
  const body = $input.first().json.body;

  const lead_name        = body.lead_name        || '';
  const phone            = body.phone            || '';
  const email            = body.email            || '';
  const source           = body.source           || '';
  const lead_message     = body.lead_message     || '';
  const property_address = body.property_address || '';
  const price_range      = body.price_range      || '';
  const beds             = body.beds             || '';
  const baths            = body.baths            || '';
  const agent_name       = body.agent_name       || '';
  const agent_email      = body.agent_email      || '';
  const agent_phone      = body.agent_phone      || '';

  const lines = [];
  if (property_address) lines.push(`Property of interest: ${property_address}`);
  if (price_range)      lines.push(`Price range: ${price_range}`);
  if (beds || baths)    lines.push(`Beds/baths: ${beds || '?'} bed / ${baths || '?'} bath`);
  if (lead_message)     lines.push(`Original message: "${lead_message}"`);

  const context_block = lines.length
    ? lines.join('\n')
    : 'General buyer inquiry — no details or message on file.';

  return [{
    json: {
      lead_name,
      phone,
      email,
      source,
      lead_message,
      property_address,
      price_range,
      beds,
      baths,
      agent_name,
      agent_email,
      agent_phone,
      has_email: email.trim().length > 0,
      context_block,
      channel: 'email',
    }
  }];
  ```

  In the JSON file this must be a single JSON string with `\n` for newlines and `\"` for quotes inside template literals. The `${}` template literal syntax does not need escaping.

- [ ] **Step 3: Verify the JSON is valid**

  Run:
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('n8n/workflows/Real Estate 7-Touch Cold Nurture.json', 'utf8')); console.log('valid')"
  ```
  Expected: `valid`

- [ ] **Step 4: Commit**

  ```bash
  git add "n8n/workflows/Real Estate 7-Touch Cold Nurture.json"
  git commit -m "feat: add context_block and channel to cold nurture Prep Fields"
  ```

---

### Task 2: Update email-channel prompt touches (T1, T3, T5)

**Files:**
- Modify: `n8n/workflows/Real Estate 7-Touch Cold Nurture.json` — nodes "Build Prompt T1", "Build Prompt T3", "Build Prompt T5"

These three touches already send email and their angles need context-adaptive wording. The property/price/beds/baths/lead_message lines are replaced with `context_block`. The `Their original message:` line is removed (now inside `context_block`).

- [ ] **Step 1: Update Build Prompt T1**

  Find node `"name": "Build Prompt T1"`. Replace the `value` field in `assignments.assignments[0]` with:

  ```
  =You are {{ $('Prep Fields').first().json.agent_name }}, a real estate agent following up with a lead who went quiet.

  LEAD: {{ $('Prep Fields').first().json.lead_name }}
  Source: {{ $('Prep Fields').first().json.source }}
  LEAD CONTEXT:
  {{ $('Prep Fields').first().json.context_block }}

  This is TOUCH 1 of 6 — Day 1. Channel: EMAIL.
  Angle: Warm follow-up. You reached out once and didn't hear back. Keep it short. Reference what you know about their search — if a property is listed use it specifically, otherwise speak to their search stage based on the context available. No pressure. Sign off with your name and phone: {{ $('Prep Fields').first().json.agent_phone }}

  Write a subject line and email body. Format exactly as:
  SUBJECT: [subject here]
  BODY: [email body here]

  Keep the body under 80 words. Warm and personal.
  ```

- [ ] **Step 2: Update Build Prompt T3**

  Find node `"name": "Build Prompt T3"`. Replace the `value` field with:

  ```
  =You are {{ $('Prep Fields').first().json.agent_name }}, a real estate agent.

  LEAD: {{ $('Prep Fields').first().json.lead_name }}
  LEAD CONTEXT:
  {{ $('Prep Fields').first().json.context_block }}

  This is TOUCH 3 of 6 — Day 7. Channel: EMAIL.
  Angle: Value-add. Share a genuine market observation — tie it to their price range if known, or speak to general buying conditions in the area if not. Make them feel like you're giving them useful intel, not chasing them. Sign off with your name and phone: {{ $('Prep Fields').first().json.agent_phone }}

  Write a subject line and email body. Format exactly as:
  SUBJECT: [subject here]
  BODY: [email body here]

  Body under 100 words. Informative, not salesy.
  ```

- [ ] **Step 3: Update Build Prompt T5**

  Find node `"name": "Build Prompt T5"`. Replace the `value` field with:

  ```
  =You are {{ $('Prep Fields').first().json.agent_name }}, a real estate agent.

  LEAD: {{ $('Prep Fields').first().json.lead_name }}
  LEAD CONTEXT:
  {{ $('Prep Fields').first().json.context_block }}

  This is TOUCH 5 of 6 — Day 14. Channel: EMAIL.
  Angle: No pressure at all. Acknowledge that timing is everything in real estate and people's situations change. You're not going anywhere. Offer to answer any questions whenever they're ready — even if it's months from now. Warm and genuinely patient tone. Sign off with your name and phone: {{ $('Prep Fields').first().json.agent_phone }}

  Write a subject line and email body. Format exactly as:
  SUBJECT: [subject here]
  BODY: [email body here]

  Body under 80 words.
  ```

- [ ] **Step 4: Verify JSON is valid**

  ```bash
  node -e "JSON.parse(require('fs').readFileSync('n8n/workflows/Real Estate 7-Touch Cold Nurture.json', 'utf8')); console.log('valid')"
  ```
  Expected: `valid`

- [ ] **Step 5: Commit**

  ```bash
  git add "n8n/workflows/Real Estate 7-Touch Cold Nurture.json"
  git commit -m "feat: update T1/T3/T5 prompts to use context_block with adaptive angles"
  ```

---

### Task 3: Convert SMS prompt touches to email format (T2, T4, T6)

**Files:**
- Modify: `n8n/workflows/Real Estate 7-Touch Cold Nurture.json` — nodes "Build Prompt T2", "Build Prompt T4", "Build Prompt T6"

These three touches currently produce SMS-formatted output (plain text, 160 chars). They need to produce `SUBJECT: / BODY:` formatted email output instead, and their angle instructions become context-adaptive.

- [ ] **Step 1: Update Build Prompt T2**

  Find node `"name": "Build Prompt T2"`. Replace the `value` field with:

  ```
  =You are {{ $('Prep Fields').first().json.agent_name }}, a real estate agent.

  LEAD: {{ $('Prep Fields').first().json.lead_name }}
  LEAD CONTEXT:
  {{ $('Prep Fields').first().json.context_block }}

  This is TOUCH 2 of 6 — Day 3. Channel: EMAIL.
  Angle: Different angle from the first message. Pick one compelling angle — a specific detail about the property if listed, a sharp market observation if you have a price range, or a genuine question about what they're prioritizing if you have neither. Make it feel like a genuine tip, not a follow-up. No "just checking in." Sign off with your name and phone: {{ $('Prep Fields').first().json.agent_phone }}

  Write a subject line and email body. Format exactly as:
  SUBJECT: [subject here]
  BODY: [email body here]

  Body under 80 words. Sharp and useful.
  ```

- [ ] **Step 2: Update Build Prompt T4**

  Find node `"name": "Build Prompt T4"`. Replace the `value` field with:

  ```
  =You are {{ $('Prep Fields').first().json.agent_name }}, a real estate agent.

  LEAD: {{ $('Prep Fields').first().json.lead_name }}
  LEAD CONTEXT:
  {{ $('Prep Fields').first().json.context_block }}

  This is TOUCH 4 of 6 — Day 10. Channel: EMAIL.
  Angle: Soft check-in. Are they still searching? Maybe their situation changed. Keep it genuinely curious, not needy. Sign off with your name: {{ $('Prep Fields').first().json.agent_name }}

  Write a subject line and email body. Format exactly as:
  SUBJECT: [subject here]
  BODY: [email body here]

  Body under 60 words. Casual and brief.
  ```

- [ ] **Step 3: Update Build Prompt T6**

  Find node `"name": "Build Prompt T6"`. Replace the `value` field with:

  ```
  =You are {{ $('Prep Fields').first().json.agent_name }}, a real estate agent.

  LEAD: {{ $('Prep Fields').first().json.lead_name }}
  LEAD CONTEXT:
  {{ $('Prep Fields').first().json.context_block }}

  This is TOUCH 6 of 6 — Day 21. Channel: EMAIL. This is the last message.
  Angle: Final touch. Low pressure, door wide open. Something like: you won't keep reaching out, but you're here whenever they're ready. Leave a genuinely warm impression. No guilt, no urgency. Sign off with your name: {{ $('Prep Fields').first().json.agent_name }}

  Write a subject line and email body. Format exactly as:
  SUBJECT: [subject here]
  BODY: [email body here]

  Body under 60 words.
  ```

- [ ] **Step 4: Update `max_tokens` for T2, T4, T6 Claude nodes**

  The Claude HTTP Request nodes for T2, T4, T6 (`Claude T2`, `Claude T4`, `Claude T6`) currently use `"max_tokens": 150` (sized for SMS). Email output needs more room. Update each to `"max_tokens": 300`.

- [ ] **Step 5: Verify JSON is valid**

  ```bash
  node -e "JSON.parse(require('fs').readFileSync('n8n/workflows/Real Estate 7-Touch Cold Nurture.json', 'utf8')); console.log('valid')"
  ```
  Expected: `valid`

- [ ] **Step 6: Commit**

  ```bash
  git add "n8n/workflows/Real Estate 7-Touch Cold Nurture.json"
  git commit -m "feat: convert T2/T4/T6 prompts from SMS to email format with context_block"
  ```

---

### Task 4: Convert SMS extract and delivery nodes to email (T2, T4, T6)

**Files:**
- Modify: `n8n/workflows/Real Estate 7-Touch Cold Nurture.json` — nodes "Extract T2/T4/T6" and "SMS T2/T4/T6"

The Extract nodes currently pull a plain `message` string. They need to split on `SUBJECT:` / `BODY:` like the email extract nodes. The Twilio delivery nodes are replaced with SendGrid nodes (same pattern as Email T1/T3/T5), and the connections and node names are updated to match.

- [ ] **Step 1: Update Extract T2**

  Find node `"name": "Extract T2"`. Replace its `parameters.jsCode` with:

  ```js
  const text = $input.first().json.content[0].text.trim();
  const subjectMatch = text.split('SUBJECT:')[1];
  const bodyMatch = text.split('BODY:')[1];
  const subject = subjectMatch ? subjectMatch.split('BODY:')[0].trim() : 'Something worth knowing';
  const body = bodyMatch ? bodyMatch.trim() : text;
  const p = $('Prep Fields').first().json;
  return [{ json: { subject, body, ...p } }];
  ```

- [ ] **Step 2: Update Extract T4**

  Find node `"name": "Extract T4"`. Replace its `parameters.jsCode` with:

  ```js
  const text = $input.first().json.content[0].text.trim();
  const subjectMatch = text.split('SUBJECT:')[1];
  const bodyMatch = text.split('BODY:')[1];
  const subject = subjectMatch ? subjectMatch.split('BODY:')[0].trim() : 'Still here';
  const body = bodyMatch ? bodyMatch.trim() : text;
  const p = $('Prep Fields').first().json;
  return [{ json: { subject, body, ...p } }];
  ```

- [ ] **Step 3: Update Extract T6**

  Find node `"name": "Extract T6"`. Replace its `parameters.jsCode` with:

  ```js
  const text = $input.first().json.content[0].text.trim();
  const subjectMatch = text.split('SUBJECT:')[1];
  const bodyMatch = text.split('BODY:')[1];
  const subject = subjectMatch ? subjectMatch.split('BODY:')[0].trim() : 'Take care';
  const body = bodyMatch ? bodyMatch.trim() : text;
  const p = $('Prep Fields').first().json;
  return [{ json: { subject, body, ...p } }];
  ```

- [ ] **Step 4: Replace SMS T2 node with Email T2**

  Find the node `"name": "SMS T2"` (type `n8n-nodes-base.twilio`). Replace the entire node object with:

  ```json
  {
    "parameters": {
      "resource": "mail",
      "fromEmail": "hello@norrai.co",
      "fromName": "={{ $json.agent_name }}",
      "toEmail": "={{ $json.email }}",
      "subject": "={{ $json.subject }}",
      "contentValue": "={{ $json.body }}",
      "additionalFields": {}
    },
    "type": "n8n-nodes-base.sendGrid",
    "typeVersion": 1,
    "position": [2640, 300],
    "id": "c3d4e5f6-0014-4000-8000-000000000014",
    "name": "Email T2",
    "credentials": { "sendGridApi": { "id": "A5ypmjiRLAUMUm9O", "name": "SendGrid account" } }
  }
  ```

  Then update the `connections` section: change `"SMS T2"` to `"Email T2"` everywhere it appears (as a key and as a `"node"` value).

- [ ] **Step 5: Replace SMS T4 node with Email T4**

  Find the node `"name": "SMS T4"` (type `n8n-nodes-base.twilio`). Replace with:

  ```json
  {
    "parameters": {
      "resource": "mail",
      "fromEmail": "hello@norrai.co",
      "fromName": "={{ $json.agent_name }}",
      "toEmail": "={{ $json.email }}",
      "subject": "={{ $json.subject }}",
      "contentValue": "={{ $json.body }}",
      "additionalFields": {}
    },
    "type": "n8n-nodes-base.sendGrid",
    "typeVersion": 1,
    "position": [4640, 300],
    "id": "c3d4e5f6-0024-4000-8000-000000000024",
    "name": "Email T4",
    "credentials": { "sendGridApi": { "id": "A5ypmjiRLAUMUm9O", "name": "SendGrid account" } }
  }
  ```

  Update connections: `"SMS T4"` → `"Email T4"` everywhere.

- [ ] **Step 6: Replace SMS T6 node with Email T6**

  Find the node `"name": "SMS T6"` (type `n8n-nodes-base.twilio`). Replace with:

  ```json
  {
    "parameters": {
      "resource": "mail",
      "fromEmail": "hello@norrai.co",
      "fromName": "={{ $json.agent_name }}",
      "toEmail": "={{ $json.email }}",
      "subject": "={{ $json.subject }}",
      "contentValue": "={{ $json.body }}",
      "additionalFields": {}
    },
    "type": "n8n-nodes-base.sendGrid",
    "typeVersion": 1,
    "position": [6640, 300],
    "id": "c3d4e5f6-0034-4000-8000-000000000034",
    "name": "Email T6",
    "credentials": { "sendGridApi": { "id": "A5ypmjiRLAUMUm9O", "name": "SendGrid account" } }
  }
  ```

  Update connections: `"SMS T6"` → `"Email T6"` everywhere.

- [ ] **Step 7: Verify JSON is valid and connections are consistent**

  ```bash
  node -e "
  const wf = JSON.parse(require('fs').readFileSync('n8n/workflows/Real Estate 7-Touch Cold Nurture.json', 'utf8'));
  const names = new Set(wf.nodes.map(n => n.name));
  const refs = new Set(Object.values(wf.connections).flatMap(v => v.main.flat().map(e => e.node)));
  const broken = [...refs].filter(r => !names.has(r));
  if (broken.length) console.error('Broken connection refs:', broken);
  else console.log('All connections valid. Node count:', wf.nodes.length);
  "
  ```
  Expected: `All connections valid. Node count: 34`

  (34 = original 34 nodes; replacing nodes in-place keeps count the same)

- [ ] **Step 8: Commit**

  ```bash
  git add "n8n/workflows/Real Estate 7-Touch Cold Nurture.json"
  git commit -m "feat: convert T2/T4/T6 extract + delivery from SMS to email"
  ```

---

### Task 5: Smoke test in n8n

- [ ] **Step 1: Import the updated workflow**

  In n8n Cloud → Workflows → Import from file → select `n8n/workflows/Real Estate 7-Touch Cold Nurture.json`. If the workflow already exists, overwrite it.

- [ ] **Step 2: Test with full context payload**

  Hit the `nurture-enroll` webhook with:
  ```json
  {
    "lead_name": "Sarah Johnson",
    "email": "your-test-email@example.com",
    "phone": "5075551234",
    "source": "zillow",
    "lead_message": "Looking for something with a big yard, ideally before fall",
    "property_address": "123 Maple St",
    "price_range": "$250k-$320k",
    "beds": "3",
    "baths": "2",
    "agent_name": "Mike Peterson",
    "agent_email": "mike@example.com",
    "agent_phone": "5075559999"
  }
  ```
  (Include `x-norr-token: 8F68D963-7060-4033-BD04-7593E4B203CB` header)

  Execute only T1 (disable Wait Day 1 or set to 0). Verify:
  - T1 email references "123 Maple St" specifically
  - Subject and body parse correctly
  - Email arrives in inbox

- [ ] **Step 3: Test with partial context payload**

  Same call but omit `property_address`, `beds`, `baths`. Verify:
  - T1 email references price range and/or message instead of a property
  - No blank "Property:" lines appear in the email
  - Email is coherent and specific to what's known

- [ ] **Step 4: Test with minimal context payload**

  Same call but omit `property_address`, `price_range`, `beds`, `baths`, `lead_message`. Verify:
  - T1 email does not reference any property details
  - Claude uses a general "buyer inquiry" angle
  - Email is still warm and professional, not awkward

- [ ] **Step 5: Spot-check a converted SMS touch (T2)**

  Fast-forward to T2 (skip wait or test directly via a modified workflow). Verify:
  - Output is email format (subject + body), not a 160-char SMS
  - SendGrid node fires, email arrives
  - Angle is different from T1

- [ ] **Step 6: Final commit if any adjustments were made during smoke test**

  ```bash
  git add "n8n/workflows/Real Estate 7-Touch Cold Nurture.json"
  git commit -m "fix: smoke test adjustments to cold nurture workflow"
  ```

---

## A2P Restore Checklist (future — do not implement now)

When A2P registration is complete, restore SMS for T2/T4/T6:

1. In Prep Fields: `channel: phone.trim() ? 'sms' : 'email'`
2. Before each of Email T2/T4/T6: add IF node on `$json.channel === 'sms'`
3. SMS branch: restore Twilio node + SMS prompt format (160 chars, no subject)
4. Email branch: keep current SendGrid node as fallback
