# Cold Nurture: Property-Null Graceful Handling

**Date:** 2026-05-17
**Status:** Approved
**Scope:** `Real Estate 7-Touch Cold Nurture.json` — `Prep Fields` node + all 6 `Build Prompt` nodes + `Extract` and delivery nodes for T2, T4, T6

---

## Problem

The cold nurture workflow was built assuming every lead has a property address, price range, and beds/baths attached. In practice, general buyer/seller inquiries arrive with no specific listing — just contact info and sometimes a message. When property fields are empty, Claude receives blank lines (`Property: \nPrice: \nBeds/Baths:  bed /  bath`) alongside angle instructions like "reference the property specifically" — leading to unpredictable output.

Additionally, the workflow has Twilio SMS nodes for T2, T4, T6 but A2P registration is not yet complete, so those touches currently can't send.

---

## Solution

Two coordinated changes:

1. **Context block in `Prep Fields`** — assemble a clean, human-readable `context_block` string from only the fields that are actually populated. All prompts reference this block instead of individual variables.
2. **Email-only mode for SMS touches** — replace T2/T4/T6 Twilio nodes with SendGrid nodes for now. `Prep Fields` exposes a `channel` field to make the A2P restore straightforward later.

---

## Detailed Design

### 1. Prep Fields (Code node)

Add two new outputs to the existing node. All existing outputs (`lead_name`, `email`, `phone`, `agent_name`, `agent_email`, `agent_phone`, `source`, `has_email`) remain unchanged.

**New output: `context_block`**

```js
const lines = [];
if (property_address) lines.push(`Property of interest: ${property_address}`);
if (price_range)      lines.push(`Price range: ${price_range}`);
if (beds || baths)    lines.push(`Beds/baths: ${beds || '?'} bed / ${baths || '?'} bath`);
if (lead_message)     lines.push(`Original message: "${lead_message}"`);

const context_block = lines.length
  ? lines.join('\n')
  : 'General buyer inquiry — no details or message on file.';
```

Examples of what Claude receives:

```
# Full context
Property of interest: 123 Maple St
Price range: $250k–$320k
Beds/baths: 3 bed / 2 bath
Original message: "Looking for something with a big yard for the kids"

# Partial context
Price range: $300k–$400k
Original message: "Just starting to look, no rush"

# Minimal context
General buyer inquiry — no details or message on file.
```

**New output: `channel`**

```js
channel: 'email'  // hardcoded until A2P registration complete
```

### 2. Prompt Templates — context block replacement

In every `Build Prompt` node, replace:

```
Property: {{ $('Prep Fields').first().json.property_address }}
Price: {{ $('Prep Fields').first().json.price_range }}
Beds/Baths: {{ $('Prep Fields').first().json.beds }} bed / {{ $('Prep Fields').first().json.baths }} bath
Their original message: {{ $('Prep Fields').first().json.lead_message }}
```

With:

```
LEAD CONTEXT:
{{ $('Prep Fields').first().json.context_block }}
```

Remove the separate `Their original message:` line from all prompts — it is now included in `context_block`.

### 3. Prompt Templates — angle instruction updates

Update the angle instruction in each touch to be context-adaptive:

| Touch | Old angle | New angle |
|-------|-----------|-----------|
| T1 (Day 1, email) | "reference the property specifically" | "reference what you know about their search — if a property is listed use it, otherwise speak to their search stage based on the context available" |
| T2 (Day 3, email) | "pick one compelling thing about the property or a sharp market observation relevant to their price range" | "pick one compelling angle — a specific detail about the property if listed, a market observation if you have a price range, or a genuine question about what they're prioritizing if you have neither" |
| T3 (Day 7, email) | "market observation relevant to their price range" | "share a market observation — tie it to their price range if known, or speak to general buying conditions in the area if not" |
| T4 (Day 10, email) | soft check-in referencing property + price | unchanged — angle is already relationship-focused and does not depend on property |
| T5 (Day 14, email) | patience/timing angle | unchanged — already property-agnostic |
| T6 (Day 21, email) | final door-open | unchanged — already property-agnostic |

### 4. SMS touches converted to email (T2, T4, T6)

**Build Prompt nodes:** Replace the SMS format instruction with the standard email format:

```
# Remove
Return ONLY the SMS text. Under 160 characters. No labels.

# Add
Write a subject line and email body. Format exactly as:
SUBJECT: [subject here]
BODY: [body here]

Body under 80 words.
```

**Extract nodes:** Replace the SMS extract pattern with the email extract pattern (same as T1/T3/T5 — split on `SUBJECT:` and `BODY:`).

**Delivery nodes:** Replace the Twilio node with a SendGrid email node matching the config of T1/T3/T5.

---

## A2P Restore Path (future)

When A2P registration is complete:

1. In `Prep Fields`: change `channel` to `'sms'` when `phone` is present, `'email'` when not.
2. Before each of T2, T4, T6: add an IF node branching on `$json.channel === 'sms'`.
3. SMS branch: restore the Twilio node and SMS-format prompt instruction.
4. Email branch: keep the current SendGrid node as the fallback.

No other changes needed — the rest of the workflow is already set up correctly.

---

## What Does Not Change

- Workflow structure (node order, wait intervals, logging)
- T1, T3, T5 delivery nodes (already SendGrid)
- Token check, enrollment DB write, workflow logging
- Agent fields (`agent_name`, `agent_email`, `agent_phone`) — still referenced directly in prompts for sign-off and email From name
- `has_email` flag — still computed in `Prep Fields` for potential future use

---

## Files Affected

- `n8n/workflows/Real Estate 7-Touch Cold Nurture.json`
  - `Prep Fields` node (Code)
  - `Build Prompt T1` through `Build Prompt T6` (Set nodes)
  - `Extract T2`, `Extract T4`, `Extract T6` (Code nodes)
  - `SMS T2`, `SMS T4`, `SMS T6` (Twilio → SendGrid)
