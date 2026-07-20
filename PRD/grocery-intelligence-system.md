# Grocery Intelligence System — Build Design

**Status:** Ready for implementation
**Audience:** Implementing agent (Claude Opus via Claude Code). This document is the source of truth. Where a decision is marked DECIDED, do not re-litigate it. Where marked ASSUMPTION, proceed as written and surface the assumption in the final README.
**Household:** 2 adult shoppers, 1+ child. Both adults submit receipts.

---

## 1. Purpose & Success Criteria

A household system that (a) captures grocery purchases from receipt photos with near-zero friction, (b) infers food waste from purchase cadence plus optional trash-moment photos, and (c) produces a weekly shopping recommendation that reduces spend and waste.

**Success criteria:**
1. Submitting a receipt takes < 15 seconds of human effort (text a photo, done).
2. ≥ 90% of receipt lines auto-resolve to canonical items by week 6 (measured as lines with `status IN ('auto','confirmed')` at time of the Sunday job).
3. Sunday message requires ≤ 1 reply from the household in a typical week.
4. By week 8, the system flags at least the top 3 waste items with a quantified recommendation ("buy 1 spinach, not 2").

**Non-goals (DECIDED — do not build):**
- No fridge/pantry photo inventory modeling.
- No meal planning or recipe features.
- No mobile app. Capture is SMS/MMS only; the dashboard is a simple web page (Phase 3).
- No multi-household/multi-tenant support. Single household, but keep `household_id` on core tables so it isn't painful later. Hardcode `household_id = 1`.
- No per-user auth beyond phone-number allowlist for inbound SMS and basic auth on the dashboard.

---

## 2. Architecture Overview

```
┌──────────────┐   MMS photo    ┌─────────────┐
│ Shopper phone ├───────────────▶│   Twilio     │
└──────────────┘                └──────┬──────┘
                                       │ webhook
                                       ▼
                              ┌────────────────┐
                              │  n8n (Cloud)    │
                              │  WF-1 Ingest    │──▶ Claude API (vision extract)
                              │  WF-2 Resolve   │──▶ Claude API (item matching)
                              │  WF-3 Waste     │──▶ Claude API (trash classify)
                              │  WF-4 Sunday    │──▶ Twilio outbound SMS
                              │  WF-5 Confirm   │◀── inbound reply SMS
                              └───────┬────────┘
                                      │
                                      ▼
                              ┌────────────────┐
                              │   Postgres      │
                              │  (managed, e.g. │
                              │   existing VPS  │
                              │   or Neon)      │
                              └───────┬────────┘
                                      │ read-only
                                      ▼
                              ┌────────────────┐
                              │ Dashboard (P3)  │
                              │ static + API    │
                              └────────────────┘
```

**Stack (DECIDED):** n8n Cloud for orchestration, Claude API (`claude-sonnet-4-6` for extraction/matching — vision-capable and cheap enough; do not use Opus for runtime calls), Twilio for SMS/MMS in and out, Postgres for storage. Receipt images stored as Twilio-hosted media URLs initially; WF-1 downloads and re-stores the bytes (see §5.2) because Twilio media URLs expire.

**Image storage (DECIDED):** store original images in a `media` table as bytea for Phase 1 simplicity (volume is trivial: ~5–10 images/week, ~1 MB each ≈ < 1 GB/year). If Postgres hosting makes bytea awkward, fallback is a `media/` directory on the VPS with the DB storing paths. Do not introduce S3.

**Environment variables (single `.env`, consumed by n8n credentials and any helper scripts):**
```
DATABASE_URL=
ANTHROPIC_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=            # the system's number
HOUSEHOLD_PHONE_NUMBERS=        # comma-separated E.164 allowlist (both shoppers)
CONFIRM_REPLY_WINDOW_HOURS=48
AUTO_MATCH_THRESHOLD=0.85       # see §6.3
NEW_ITEM_THRESHOLD=0.60
```

---

## 3. Data Model (Postgres DDL — authoritative)

Run as migration 001. All timestamps are `timestamptz`, UTC in storage; America/Chicago for all user-facing rendering and week boundaries.

```sql
-- ============ reference ============
CREATE TABLE households (
  household_id   int PRIMARY KEY,
  name           text NOT NULL,
  timezone       text NOT NULL DEFAULT 'America/Chicago'
);
INSERT INTO households VALUES (1, 'Home', 'America/Chicago');

CREATE TABLE stores (
  store_id       serial PRIMARY KEY,
  name           text NOT NULL,           -- 'Fareway', 'Hy-Vee', 'Costco', 'Target'
  name_aliases   text[] NOT NULL DEFAULT '{}',  -- strings Claude may extract from headers
  UNIQUE (name)
);

CREATE TABLE canonical_items (
  item_id             serial PRIMARY KEY,
  name                text NOT NULL UNIQUE,       -- lowercase singular: 'spinach'
  category            text NOT NULL,              -- see seed list §3.1
  base_unit           text NOT NULL CHECK (base_unit IN ('g','ml','each')),
  perishability_tier  text NOT NULL CHECK (perishability_tier IN
                        ('fresh_short','fresh_medium','fridge_stable','frozen','pantry')),
  shelf_life_days     int NOT NULL,               -- typical usable life from purchase
  active              boolean NOT NULL DEFAULT true
);

-- ============ ingestion ============
CREATE TABLE media (
  media_id     bigserial PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('receipt','trash')),
  content_type text NOT NULL,
  bytes        bytea NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  from_phone   text NOT NULL,
  message_sid  text UNIQUE                -- Twilio MessageSid; dedupes webhook re-delivery
);

CREATE TABLE llm_calls (
  call_id     bigserial PRIMARY KEY,
  workflow    text NOT NULL,              -- 'WF-1'..'WF-5'
  receipt_id  bigint,
  tokens_in   int, tokens_out int, ms int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receipts (
  receipt_id     bigserial PRIMARY KEY,
  household_id   int NOT NULL REFERENCES households,
  media_id       bigint NOT NULL REFERENCES media,
  store_id       int REFERENCES stores,            -- NULL until extraction resolves it
  purchased_at   date,                             -- from receipt; fallback = received date
  total_cents    int,                              -- receipt grand total as printed
  extract_status text NOT NULL DEFAULT 'pending'
                 CHECK (extract_status IN ('pending','extracted','failed','needs_review')),
  extract_error  text,
  raw_extract    jsonb,                            -- full Claude JSON, always kept
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_lines (
  line_id        bigserial PRIMARY KEY,
  receipt_id     bigint NOT NULL REFERENCES receipts,
  line_no        int NOT NULL,
  raw_text       text NOT NULL,                    -- verbatim from receipt
  qty            numeric NOT NULL DEFAULT 1,       -- count of units purchased
  unit_size      numeric,                          -- size of one unit, if printed (10 for '10OZ')
  unit           text,                             -- 'oz','lb','ct','g','ml','each', NULL if unknown
  price_cents    int NOT NULL,                     -- extended line price AFTER line discounts
  is_taxable_fee boolean NOT NULL DEFAULT false,   -- bag fees, deposits: excluded from analytics
  item_id        int REFERENCES canonical_items,   -- NULL until resolved
  match_status   text NOT NULL DEFAULT 'unresolved'
                 CHECK (match_status IN ('unresolved','auto','confirmed','pending','ignored')),
  match_confidence numeric,
  UNIQUE (receipt_id, line_no)
);

CREATE TABLE raw_item_map (
  map_id       bigserial PRIMARY KEY,
  store_id     int NOT NULL REFERENCES stores,
  raw_text     text NOT NULL,
  item_id      int NOT NULL REFERENCES canonical_items,
  status       text NOT NULL CHECK (status IN ('auto','confirmed')),
  confidence   numeric,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, raw_text)
);

-- ============ waste ============
CREATE TABLE waste_events (
  waste_id     bigserial PRIMARY KEY,
  household_id int NOT NULL REFERENCES households,
  media_id     bigint REFERENCES media,            -- NULL for inferred waste
  item_id      int REFERENCES canonical_items,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL CHECK (source IN ('photo','inferred')),
  est_fraction numeric,                            -- 0–1: how much of a purchase unit was wasted
  est_cost_cents int,
  note         text,
  raw_extract  jsonb
);

-- ============ weekly cycle ============
CREATE TABLE weeks (
  week_start   date PRIMARY KEY,                   -- Monday, America/Chicago
  household_id int NOT NULL REFERENCES households,
  atypical     boolean NOT NULL DEFAULT false,     -- vacation, party, etc. (set via SMS reply)
  atypical_note text
);

CREATE TABLE recommendations (
  rec_id       bigserial PRIMARY KEY,
  week_start   date NOT NULL REFERENCES weeks,
  item_id      int NOT NULL REFERENCES canonical_items,
  rec_qty      numeric NOT NULL,                   -- recommended purchase qty (in purchase units)
  baseline_qty numeric NOT NULL,                   -- what they'd buy by habit (rolling median)
  reason       text NOT NULL,                      -- human-readable, goes in the SMS
  UNIQUE (week_start, item_id)
);

CREATE TABLE rec_feedback (
  rec_id        bigint PRIMARY KEY REFERENCES recommendations,
  actual_qty    numeric,       -- filled by following week's job from purchase_lines
  followed      boolean        -- |actual - rec| <= |actual - baseline|
);

-- ============ conversational state ============
CREATE TABLE pending_confirmations (
  confirm_id   bigserial PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('item_match','atypical_week')),
  payload      jsonb NOT NULL,     -- e.g. {"line_ids":[...], "proposed_item_id": 12, "raw_text": "..."}
  ordinal      int NOT NULL,       -- 1,2,3... position in this batch; replies reference it
  sent_at      timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  resolved     boolean NOT NULL DEFAULT false,
  resolution   text                -- 'yes','no','ignored','expired'
);

CREATE INDEX idx_lines_unresolved ON purchase_lines (match_status) WHERE match_status IN ('unresolved','pending');
CREATE INDEX idx_lines_item_receipt ON purchase_lines (item_id, receipt_id);
CREATE INDEX idx_receipts_date ON receipts (household_id, purchased_at);
```

### 3.1 Seed data (migration 002)

**Categories (fixed vocabulary):** `produce, dairy, meat_seafood, bakery, frozen, pantry, beverages, snacks, deli, household, baby, other`. `household` and `baby` (diapers, wipes) are tracked for spend but **excluded from waste inference and recommendations** — flag via category, not a separate table.

**Canonical items:** seed ~60 items covering a typical weekly basket. The implementing agent should generate the full seed from this pattern — 15 examples to anchor tier/shelf-life judgment:

| name | category | base_unit | tier | shelf_life_days |
|---|---|---|---|---|
| spinach | produce | g | fresh_short | 5 |
| lettuce | produce | each | fresh_short | 7 |
| banana | produce | each | fresh_short | 5 |
| apple | produce | each | fresh_medium | 21 |
| berries | produce | g | fresh_short | 4 |
| milk | dairy | ml | fridge_stable | 10 |
| yogurt | dairy | g | fridge_stable | 21 |
| shredded cheese | dairy | g | fridge_stable | 30 |
| eggs | dairy | each | fridge_stable | 28 |
| chicken breast | meat_seafood | g | fresh_short | 2 |
| ground beef | meat_seafood | g | fresh_short | 2 |
| bread | bakery | each | fresh_medium | 7 |
| tortillas | bakery | each | fridge_stable | 21 |
| frozen vegetables | frozen | g | frozen | 240 |
| rice | pantry | g | pantry | 720 |

Granularity rule (DECIDED): collapse variants aggressively. Organic vs. conventional, brand differences, and pack sizes are the **same** canonical item. Different buying decisions = different items (whole milk ≠ oat milk; chicken breast ≠ chicken thighs). Target 50–80 active items. If finer grain is needed later, add a `variant` text column; never split an existing canonical item.

**Stores:** seed `Fareway`, `Hy-Vee`, `Costco`, `Target`, `Walmart`, `Aldi`, `Cub Foods` with common header aliases. WF-1 creates new stores on the fly if extraction finds an unknown header (insert with extracted name; no confirmation needed).

---

## 4. Workflow Inventory (n8n)

| ID | Name | Trigger | Purpose |
|---|---|---|---|
| WF-1 | Receipt Ingest | Twilio inbound webhook (MMS) | Store media, extract receipt with Claude vision, land purchase_lines |
| WF-2 | Item Resolution | Cron: hourly | Resolve unresolved lines via map lookup → Claude matching |
| WF-3 | Waste Photo | Same webhook as WF-1 (routed by classification) | Classify trash photo, write waste_event |
| WF-4 | Sunday Brief | Cron: Sunday 8:00 AM America/Chicago | Weekly analytics, recommendations, confirmations → one SMS |
| WF-5 | Reply Handler | Twilio inbound webhook (SMS, no media) | Parse replies to confirmations / atypical-week flags |
| WF-6 | Rec Feedback | Cron: Sunday 7:45 AM (before WF-4) | Score last week's recommendations against actual purchases |

A single Twilio number and a single inbound webhook serve WF-1/WF-3/WF-5. The webhook entry node routes: has media → image router (§4.1); text only → WF-5 logic. Reject any sender not in `HOUSEHOLD_PHONE_NUMBERS` (silently drop, log).

### 4.1 Image routing (inside WF-1 entry)

One Claude call decides whether an inbound image is a receipt or a trash photo — do not make the humans use different numbers or keywords. Prompt (system):

```
You are an image router. Look at the image and respond with ONLY one word:
RECEIPT  — if the image is a printed store receipt (itemized text, totals)
TRASH    — if the image shows food being discarded (food items, trash bin, compost, spoiled food)
OTHER    — anything else
```

Route RECEIPT → §5, TRASH → §7.1, OTHER → reply SMS: "Couldn't tell what that was — send a receipt or a photo of food you're tossing."

---

## 5. WF-1: Receipt Ingest

### 5.1 Flow
1. Twilio webhook fires with `MediaUrl0..N`, `From`.
2. Validate sender against allowlist.
3. For each media URL: download bytes (Twilio auth), insert into `media (kind='receipt')`. Multi-image messages = one receipt photographed in sections; process all images in ONE extraction call (Claude accepts multiple images) and land as one receipt.
4. Insert `receipts (extract_status='pending')`.
5. Call Claude extraction (§5.2). On success: update receipt header fields, insert `purchase_lines`, set `extract_status='extracted'`, store full JSON in `raw_extract`.
6. Validation: `SUM(price_cents) of non-fee lines` must be within 10% or $3 of extracted `total_cents` (pre-tax subtotal if available, else total). If not → `extract_status='needs_review'`, still land the lines, and include a one-line note in the next Sunday brief. Do NOT block or immediately text the user.
7. Reply SMS: "Got it — {store}, ${total}, {n} items." On extraction failure after 2 retries: `extract_status='failed'`, reply "Couldn't read that receipt — try a flatter, brighter photo?"
8. Fire WF-2 immediately for this receipt (don't wait for the hourly cron).

### 5.2 Extraction prompt (verbatim, system role)

```
You extract structured data from grocery receipt photos. Respond with ONLY a JSON object, no markdown fences, no preamble.

Schema:
{
  "store_name": string,            // as printed in the header
  "purchased_at": "YYYY-MM-DD" | null,
  "subtotal_cents": int | null,    // pre-tax subtotal if printed
  "total_cents": int | null,       // grand total
  "lines": [
    {
      "line_no": int,              // 1-based, order printed
      "raw_text": string,          // the item text exactly as printed
      "qty": number,               // units purchased; default 1
      "unit_size": number | null,  // size of ONE unit if printed (e.g. 10 for "10OZ")
      "unit": "oz"|"lb"|"g"|"kg"|"ml"|"l"|"ct"|"each"|null,
      "price_cents": int,          // extended price for the line AFTER discounts
      "is_fee": boolean            // bag fee, bottle deposit, tax line
    }
  ]
}

Rules:
- "3 @ 1.99" or "2/5.00" style: qty is the count, price_cents is the extended total.
- Discount/coupon lines (negative amounts) are NOT separate lines: subtract them from the immediately preceding item line's price_cents. If a discount cannot be tied to a line, subtract it proportionally from all lines and note nothing.
- Weighted produce ("1.34 lb @ 2.99/lb"): qty=1, unit_size=1.34, unit="lb", price_cents=extended.
- TAX, SUBTOTAL, TOTAL, CHANGE, payment lines: exclude from lines entirely (totals go in header fields).
- Bag fees / bottle deposits: include as lines with is_fee=true.
- If text is illegible for a line, include it with your best-guess raw_text and qty=1; never drop a line silently.
- If the image is not readable at all, respond: {"error": "unreadable"}
```

Call parameters: model `claude-sonnet-4-6`, max_tokens 4000, images attached as base64. Parse with fence-stripping (`replace(/```json|```/g,'')`) then `JSON.parse`; retry once on parse failure with an appended user message "Your previous response was not valid JSON. Respond with only the JSON object."

### 5.3 Unit normalization (in code, not in the prompt)

Convert to canonical base units at analytics time, storing the raw values in `purchase_lines` untouched:
`oz→g ×28.35`, `lb→g ×453.6`, `l→ml ×1000`, `kg→g ×1000`, `ct/each→each`. If a line's unit is NULL and the canonical item's base_unit is `g` or `ml`, treat the line as 1 purchase-unit and do quantity analytics in purchase-units (counts of typical packages) rather than mass. **DECIDED:** recommendations are always expressed in purchase units ("buy 1 bag of spinach"), never grams — mass normalization exists only for waste-fraction math where unit_size is known.

---

## 6. WF-2: Item Resolution

### 6.1 Waterfall (per unresolved line)
1. **Exact map hit:** `SELECT item_id FROM raw_item_map WHERE store_id=? AND raw_text=?`. Hit → set `item_id`, `match_status = map.status` (`auto` or `confirmed`), done. Zero API cost; expected hit rate > 90% after ~4 weeks.
2. **Claude match** (batch all remaining unresolved lines for a receipt into ONE call — §6.2).
3. Threshold routing (§6.3).

### 6.2 Matching prompt (verbatim, system role)

```
You match grocery receipt line items to a canonical item list for a household tracker. Respond with ONLY a JSON array, no markdown fences.

You will receive:
1. The canonical item list as JSON: [{"item_id": int, "name": str, "category": str}]
2. Confirmed example mappings from this store (few-shot): [{"raw_text": str, "item_name": str}]
3. Lines to match: [{"line_no": int, "raw_text": str, "qty": num, "unit": str, "price_cents": int}]

For each line respond:
{
  "line_no": int,
  "item_id": int | null,        // null if no canonical item fits
  "new_item_name": str | null,  // proposed canonical name if item_id is null (lowercase, singular, generic)
  "new_item_category": str | null,  // one of the provided categories
  "confidence": number,         // 0-1
  "reasoning": str              // <= 10 words
}

Guidance:
- Receipt abbreviations are aggressive: "GV" = Great Value (brand, ignore), "ORG" = organic (ignore for matching), "KDL FRM" = Kwik/Crystal Farms etc. Brands never matter; the underlying food does.
- Use price and unit as signals: $3.49 "ORG SPIN" is spinach, not a spin class.
- Collapse variants: organic/conventional, brands, and pack sizes map to the SAME item. Only fundamentally different foods are different items.
- Non-food household goods (paper towels, detergent) match to household-category items; propose new ones if missing.
- confidence >= 0.9 only when the mapping is essentially certain.
```

Few-shot examples: pull up to 20 most recent `raw_item_map` rows with `status='confirmed'` for the store. This is the learning loop — the system absorbs each store's abbreviation style over time.

### 6.3 Threshold routing (thresholds from env)
- `confidence >= AUTO_MATCH_THRESHOLD (0.85)` and `item_id` present → set line `item_id`, `match_status='auto'`; upsert `raw_item_map (status='auto')`.
- `item_id` null and `confidence >= NEW_ITEM_THRESHOLD (0.60)` for the proposed new item → **create the canonical item immediately** (with category defaults: base_unit='each', tier/shelf_life by category lookup table below), map it, `match_status='auto'`. Creating a slightly-wrong item beats stalling the pipeline; the Sunday brief lists new items created so a human can veto.
- Otherwise → `match_status='pending'`, queue a `pending_confirmations (kind='item_match')` row for the Sunday brief. Lines can stay pending for up to a week; that's fine — analytics simply excludes them and the brief reports the pending count.

Category → default tier/shelf-life for auto-created items:
`produce → fresh_short/5`, `dairy → fridge_stable/14`, `meat_seafood → fresh_short/2`, `bakery → fresh_medium/7`, `frozen → frozen/240`, `pantry|snacks|beverages|household|baby|other → pantry/365`, `deli → fresh_short/4`.

### 6.4 SKU drift & remapping
Store SKU renames appear as new raw_text and flow through matching naturally — no special handling. If a canonical mapping is later found wrong, the fix is: update `raw_item_map`, then `UPDATE purchase_lines SET item_id=... WHERE raw_text=... AND receipt_id IN (that store's receipts)`. Provide this as a helper SQL script (`scripts/remap.sql` with parameters documented), not a UI.

---

## 7. Waste Tracking

Two independent signals, both landing in `waste_events`. They are never merged into one number; the Sunday job uses photo events as ground truth where present and inference elsewhere.

### 7.1 WF-3: Trash-moment photos (`source='photo'`)

Flow: image router says TRASH → classification call → insert `waste_events` → reply "Logged: {item}, ~{pct}% of it. 💸 ~${cost}".

Classification prompt (system):

```
You identify discarded food in a photo for a household waste tracker. Respond with ONLY JSON, no fences.

You receive the canonical item list: [{"item_id": int, "name": str}]

Respond:
{
  "events": [
    {
      "item_id": int | null,     // null if food is identifiable but not in the list
      "item_guess": str,          // what you see, always filled
      "est_fraction": number,     // 0-1: how much of a typical purchase unit is being tossed
      "confidence": number
    }
  ]
}
Multiple foods in one photo = multiple events. If no food is visible, respond {"events": []}.
```

Cost estimation: `est_cost_cents = est_fraction × avg(price_cents/qty)` over that item's last 5 purchase lines. If `item_id` is null, land the event with `item_id NULL` and the guess in `note`; it still counts toward total waste dollars, just not per-item rates.

### 7.2 Cadence inference (`source='inferred'`, computed in WF-4)

Core idea: for perishables, if the median re-purchase interval materially exceeds shelf life, the surplus was probably wasted; conversely if intervals are shorter than consumption would require, quantity per trip is too high.

Algorithm (run per canonical item, per Sunday, over a trailing 8-week window excluding `atypical` weeks):

```
eligible = items where perishability_tier IN ('fresh_short','fresh_medium')
           AND category NOT IN ('household','baby')
           AND >= 4 purchases in window

for each eligible item:
    purchases = ordered list of (purchased_at, total_qty_that_day)
    intervals = day-gaps between consecutive purchase dates
    med_interval = median(intervals)
    med_qty      = median(total_qty_that_day)      -- in purchase units

    -- Interpretation:
    -- consumption_rate ≈ what they actually eat per day, bounded by shelf life:
    -- anything from a purchase not consumed within shelf_life_days is waste.
    usable_days   = min(med_interval, shelf_life_days)
    waste_frac    = max(0, (med_interval - shelf_life_days) / med_interval)
                    -- fraction of the inter-purchase period the food was expired
    -- qty-side signal: if they buy 2/trip but the interval implies 1 would last:
    implied_qty   = med_qty * (usable_days / med_interval)   -- what they'd need per trip
    excess_qty    = max(0, med_qty - ceil_to_half(implied_qty))

    if waste_frac >= 0.25 OR excess_qty >= 0.5:
        insert waste_events(source='inferred', item_id,
            est_fraction = waste_frac if waste_frac>0 else excess_qty/med_qty,
            est_cost_cents = est_fraction * med_qty * median_unit_price,
            note = 'cadence inference wk {week_start}')
```

`ceil_to_half(x)` = round up to nearest 0.5. Guardrails (DECIDED):
- Never infer waste for an item that has a photo waste_event in the window — photo truth wins, and double counting inflates rates.
- Never infer for items with < 4 purchases (cold start).
- Cap est_fraction at 0.75 — inference should never claim near-total waste; that's a data problem, not a behavior problem.
- Freezer-rescue caveat: chicken bought fresh and frozen looks like waste to this model. Mitigation: the Sunday brief phrases inferred waste as a question the first time an item crosses the threshold ("Looks like ~half the chicken breast may go unused — do you usually freeze it? Reply FREEZE CHICKEN to exclude it"). `FREEZE {item}` reply (WF-5) flips the item's tier to `frozen`, removing it from inference permanently.

---

## 8. Recommendations (WF-4 core logic)

For each item with a purchase in the last 3 weeks OR a recommendation last week:

```
baseline_qty = rolling median of qty-per-week over trailing 6 non-atypical weeks
waste_rate   = (photo waste_frac if any in window, else inferred waste_frac, else 0)
rec_qty      = max(0.5, round_to_half(baseline_qty * (1 - waste_rate)))

emit recommendation ONLY when rec_qty != baseline_qty  -- silence = "keep doing what you're doing"
reason examples:
  "buy 1 spinach (you've been buying 2; ~1 goes bad)"
  "skip berries this week — last 2 packs went uneaten"   -- when rec_qty rounds to 0.5 and baseline <= 1
```

**Trust loop (WF-6, runs before WF-4):** for last week's recommendations, compute `actual_qty` from purchase_lines, set `followed = |actual−rec| <= |actual−baseline|`. If an item's rec was NOT followed 2 consecutive weeks, suppress that item's recommendations for 4 weeks (they've voted with their cart; nagging erodes trust in the whole system). Track suppressions in `rec_feedback` via `followed=false` streaks — no extra table needed; compute streaks in SQL.

**Cold start schedule (DECIDED):**
- Weeks 1–2: Sunday brief is spend-summary only. No recommendations, no inference.
- Weeks 3–4: add "your regulars" list (top items by frequency) + pending confirmations.
- Week 5+: full recommendations + waste inference, gated on ≥ 4 purchases per item as above.
Implement as: recommendation/inference sections check `(SELECT count(*) FROM weeks)` and per-item purchase counts; no feature flags.

---

## 9. WF-4: Sunday Brief (single SMS, 8:00 AM Sun America/Chicago)

Assembly order (omit any empty section; hard cap ~900 chars, truncate recommendations list before anything else):

```
🛒 Week of {mon}–{sun}: ${total} ({pct_vs_4wk_avg} vs your 4-wk avg)
Top: {cat1} ${x}, {cat2} ${y}, {cat3} ${z}

💡 This week: {rec reasons, max 3, ordered by est_cost saved}

🗑 Waste: ~${waste_total} ({n} items)   [only if > $2]

❓ Quick check ({k}):
1) Is "KDL FRM CHZ STK" cheese sticks? (y1/n1)
2) New item added: "kombucha" — ok? (y2/n2)
Reply like "y1 n2". Anything unanswered auto-expires in 48h.
Also: reply BUSY if last week wasn't typical (guests/travel).
```

Number formatting: whole dollars. The `y1/n1` ordinal scheme maps to `pending_confirmations.ordinal`; a batch is at most 3 questions — remaining confirmations roll to next week (oldest first).

### 9.1 WF-5: Reply handler (text-only inbound)

Parse rules, case-insensitive, tolerate whitespace:
- `y{n}` / `n{n}` tokens → resolve confirmation `ordinal=n` from the most recent unexpired batch. `y` on item_match: flip lines to `confirmed`, upsert map `status='confirmed'`. `n` on item_match: set lines `match_status='pending'` again, mark confirmation resolved='no', and queue a follow-up question next Sunday offering the top-2 alternative items from the original match call's reasoning (store alternatives in the confirmation payload at creation time).
- `BUSY` → set current-or-most-recent week `atypical=true`, reply "Got it — excluding last week from your baselines."
- `FREEZE {item}` → fuzzy-match item name against canonical_items (Postgres `similarity()`; take best if > 0.4), set tier='frozen', confirm by SMS.
- Anything else → single Claude call with the parse rules as context to interpret intent; if still unclear, reply "Didn't catch that — reply like 'y1 n2', or BUSY, or FREEZE {item}."

---

## 10. Phase 3: Dashboard (build LAST, only after 2 weeks of live data)

Single-page read-only web app, basic-auth, served from the VPS (or n8n webhook returning HTML — implementer's choice, keep it trivial). Contents: weekly spend trend (12 wk line), spend by category (stacked bars), waste $ trend, top-10 items by spend and by waste rate, pending/failed receipt list. Plain HTML + a chart lib from CDN; direct read-only Postgres queries through a tiny API layer. No framework requirement. This phase is explicitly cuttable.

---

## 11. Implementation Plan & Acceptance Tests

**Build order (each step independently testable):**
1. Migrations 001–002; `scripts/remap.sql`; seed the ~60 canonical items.
2. WF-1 without Claude: webhook → media storage → receipt row. Test: text a photo, see rows.
3. Extraction integrated. Test fixtures: create 5 synthetic receipt images (script them with PIL — printed-style text on white, one per store format quirk: multibuy "3 @ 1.99", weighted produce, coupon line, bottle deposit, two-image long receipt). Assert line counts, price math, fee flags, and the §5.1-step-6 total validation on each.
4. WF-2 + thresholds. Test: run twice on same receipt — second run must be 100% map hits, 0 API calls.
5. WF-3 image router + trash classification. Test: send a receipt and a food photo; assert correct routing.
6. WF-4 spend-summary sections + WF-5 y/n + BUSY parsing. Test with seeded fake weeks.
7. Inference + recommendations + WF-6. Test: synthetic purchase history where spinach is bought 2/wk with 9-day median interval and 5-day shelf life → expect a "buy 1" recommendation; assert the FREEZE path removes an item.
8. Dashboard.

**Operational notes:**
- All Claude calls: 2 retries with exponential backoff; on final failure, mark the relevant row failed/needs_review and continue — no workflow may crash the batch for one bad row.
- Log every Claude call to `llm_calls` (in migration 001). Expected steady-state cost: well under $5/mo.
- Idempotency: Twilio can re-deliver webhooks. Dedupe on `media.message_sid` (in migration 001) — skip processing if the sid already exists.

**ASSUMPTIONS surfaced for the README:** Twilio number is already provisioned; Postgres is the existing VPS instance; both shoppers' numbers go in the allowlist; America/Chicago everywhere; single household hardcoded to id 1.
