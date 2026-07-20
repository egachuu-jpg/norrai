# Decisions Pending v2 — Household CFO (Finance Design Doc)

**Date:** 2026-07-15
**Status:** Draft for Egan's review — nothing built; per the Decisions Pending
dev spec §7, finance is v2 and design precedes any scaffolding
**Builds on:** `decisions-pending/` (cos schema, cos API, n8n collectors, Hermes)
**Companion:** dev spec ("Decisions Pending — Implementation Plan"), `PRD/cos-v2-internal.md`

---

## 1. Goal & Non-Goals

**Goal:** give the personal chief-of-staff a comprehensive, current view of
household finances — Community Resource Bank (checking), Citi card, Apple Card,
two Vanguard accounts, Robinhood — so the morning digest carries a finance
section and Hermes can answer "how are we doing?" from Telegram.

**Non-goals (v2):**
- No money movement, no payments, no trading — read-only, forever, at the
  architecture level (not just a prompt promise).
- No budgeting engine or category rules in v2 — balances, transactions, and
  a handful of derived alerts. Budgets are v3 if the v2 data proves useful.
- No spouse/multi-user identity model — same single-user posture as v1.

---

## 2. Locked Constraints (inherited, not renegotiable in this doc)

1. **Financial credentials live only in the data plane** — the n8n credential
   store on the Norr AI box, beside the Twilio/SendGrid keys. Nothing
   financial ever reaches the Hermes VPS: `decisions-pending/scripts/
   audit_vps.sh` already fails the audit if a bank/Plaid-shaped token appears
   there, and that stays true in v2.
2. **Hermes reads summaries through the cos API only.** The cos_api Postgres
   role gets `SELECT` on the new finance tables — no INSERT/UPDATE/DELETE.
   All writes come from n8n's own credential.
3. **Prompt changes are version bumps** — the digest gains a finance section
   via `digest_synthesis_v2.md`, never by editing v1 in place.

---

## 3. Account Inventory & Ingestion Paths

Aggregator coverage is uneven, so v2 uses two ingestion tiers:

| Account | Kind | Path | Cadence | Notes |
|---|---|---|---|---|
| Community Resource Bank | checking | **SimpleFIN** (verify in institution search first) | daily | Small MN community bank — coverage must be confirmed before committing; CSV fallback if absent |
| Citi credit card | credit_card | **SimpleFIN** | daily | Mainstream coverage, should be reliable |
| Apple Card | credit_card | **CSV import** | monthly | No aggregator supports Apple Card; Wallet app exports monthly CSV/OFX only |
| Vanguard ×2 | brokerage/retirement | **CSV import** (balance snapshot) | monthly | Aggregator links to Vanguard are historically flaky; a monthly balance is enough for a digest |
| Robinhood | brokerage | **CSV import** (balance snapshot) | monthly | No official personal API; same treatment as Vanguard |

**Decision — aggregator: SimpleFIN Bridge, not Plaid.**
- Built for exactly this use case (personal finance, read-only by protocol —
  the access token *cannot* initiate transfers), ~$1.50/month flat.
- No developer-app approval process; Plaid production access is real friction
  for a single-household integration and bills per connected account.
- Broad small-institution coverage (MX under the hood), which matters for the
  community bank. **Gate:** before building anything, Egan checks that
  Community Resource Bank and Citi both appear in SimpleFIN's institution
  search. If the community bank is missing, it drops to the CSV tier and the
  aggregator still earns its keep on Citi alone — or we revisit Plaid.

**CSV drop mechanism:** a dedicated Google Drive folder per account
(`Finance Imports/<account>/`), watched by an n8n workflow. Egan already has
Google credentials in n8n from the collectors; exporting from the Wallet app /
Vanguard / Robinhood to Drive is a phone-native action. Parsed files are
tagged processed (moved to a `done/` subfolder) so re-runs are idempotent.

---

## 4. Schema (sketch — final DDL at build time, same conventions as 001)

Three tables in the `cos` schema, `IF NOT EXISTS`, dates via
`cos.today_chicago()` where "today" matters:

```sql
cos.fin_accounts (
  id           uuid PK,
  institution  text NOT NULL,           -- 'community_resource_bank' | 'citi' | 'apple_card' | 'vanguard' | 'robinhood'
  name         text NOT NULL,           -- display label, e.g. 'Vanguard — Roth IRA'
  kind         text CHECK (kind IN ('checking','savings','credit_card','brokerage','retirement')),
  ingestion    text CHECK (ingestion IN ('simplefin','csv_import','manual')),
  external_ref text,                    -- aggregator account id, NULL for csv/manual
  active       boolean DEFAULT true,
  UNIQUE (institution, name)
)

cos.fin_balances (                      -- append-only daily/monthly snapshots
  id         uuid PK,
  account_id uuid REFERENCES cos.fin_accounts(id),
  as_of      date NOT NULL,
  balance    numeric(14,2) NOT NULL,    -- credit cards: negative = amount owed
  available  numeric(14,2),
  source     text NOT NULL,             -- 'simplefin' | 'csv' | 'manual'
  UNIQUE (account_id, as_of)            -- idempotent daily upsert
)

cos.fin_transactions (
  id           uuid PK,
  account_id   uuid REFERENCES cos.fin_accounts(id),
  external_ref text NOT NULL,           -- aggregator txn id, or sha256(date|amount|description) for CSV rows
  posted_on    date NOT NULL,
  amount       numeric(14,2) NOT NULL,  -- negative = outflow
  description  text NOT NULL,
  category     text,                    -- aggregator-provided if present; no rules engine in v2
  metadata     jsonb DEFAULT '{}',
  UNIQUE (account_id, external_ref)     -- idempotent sync
)
```

**Grants:** `GRANT SELECT ON cos.fin_accounts, cos.fin_balances,
cos.fin_transactions TO cos_api;` — read-only, matching constraint §2.2.
n8n writes with its own credential, exactly like the collectors.

**Retention/privacy note:** this puts household transaction history in the
same Neon project as NorrAI client data. Acceptable for a solo operator, but
worth a conscious yes from Egan; the alternative (separate Neon project)
costs one more DATABASE_URL in n8n and nothing else.

---

## 5. The Integration That Makes It a CFO, Not a Dashboard

Finance events materialize as **`pending_decisions` rows** via a nightly SQL
step appended to the existing escalation job — which means they inherit the
entire existing machinery for free: surfacing windows, urgency escalation,
digest numbering, done/snooze/dismiss from Telegram, anti-staleness nags.

Nightly rules (pure SQL, idempotent via `UNIQUE (source, source_ref)`):

| Trigger | Decision row |
|---|---|
| Credit-card payment window (statement close + N days, per account config) | "Pay Citi card — $X due YYYY-MM-DD", deadline = due date, source_ref = `finance:citi:2026-07` |
| Checking balance below floor (e.g. $500) | "Checking low: $X — move money?", no deadline, urgency high |
| Single transaction over threshold (e.g. $500) | "Review: $X at MERCHANT on Citi", low urgency, auto-expires |
| CSV import overdue (no Apple Card/Vanguard/Robinhood snapshot in >40 days) | "Export MERCHANT statement to Drive" — the system nags Egan to feed it |

Requires widening the `source` CHECK on `pending_decisions` from
`('manual','email','calendar','recurring','system')` to include `'finance'` —
a one-line migration, flagged here per the "don't touch the schema silently"
rule. Thresholds live in a tiny `cos.fin_rules` config table (or start
hardcoded in the SQL — Egan's call; hardcoded is fine at this scale).

---

## 6. Surface Changes

**cos API — one new endpoint** (flagged per dev spec §7, this doc is the flag):
`GET /finance/summary` → per-account latest balance + as_of, net cash,
total card debt, 30-day inflow/outflow. Read-only, same bearer auth,
no by-position semantics needed.

**Digest — `digest_synthesis_v2.md`** (version bump): payload gains
`finance: {as_of, accounts[], net_cash, card_debt, flags[]}`; rules gain one
line — a single 💰 line after the weather ("💰 Cash $X · Cards −$Y · flags"),
expanding only when a flag exists. Terse; the *actionable* finance items
already appear as numbered decisions via §5.

**Hermes — cos-assistant SKILL.md v1.1:** add one read command
("balances" / "how are we doing?" → `GET /finance/summary`) and update the
guardrail honestly: Hermes can *read financial summaries via the cos API*;
it still holds no financial credentials and cannot move money. The
audit-script posture is unchanged — no new secrets on the VPS.

**n8n — two new workflows** (logging standard applies, registry entries in
`n8n/README.md`):
- `cos_finance_sync` — daily 05:10 CT: SimpleFIN pull → upsert accounts/
  balances/transactions → run §5 rules SQL.
- `cos_finance_import` — Drive-folder watcher: parse CSV/OFX → upsert →
  move file to `done/`.

---

## 7. Build Order & Acceptance

| Step | Scope | Done when |
|---|---|---|
| 0 | Egan: SimpleFIN Bridge account; confirm Community Resource Bank + Citi in institution search; decide same-vs-separate Neon project (§4 note) | Both answers recorded here |
| 1 | Migration: 3 fin tables + grants + `source` CHECK widening | Applied to Neon; cos_api can SELECT, cannot INSERT (extend `test_role_privileges.py`) |
| 2 | `cos_finance_sync` (SimpleFIN accounts only) | Two consecutive daily runs upsert without duplicates; balances visible in Neon |
| 3 | `cos_finance_import` + Drive folders | One real Apple Card CSV round-trips: export → Drive → rows in Neon → file in `done/` |
| 4 | §5 rules SQL appended to nightly job | Card-due decision appears in digest, completable via "done N" from Telegram |
| 5 | `GET /finance/summary` + digest v2 prompt + SKILL.md v1.1 | "balances" answers in Telegram; 💰 line in next morning's digest |

Each step independently shippable; stop after any step and the system still
works. Estimated effort: steps 1–2 one evening, 3–5 one evening each.

## 8. Open Questions for Egan (blocking step 0/1 only)

1. SimpleFIN institution search: are Community Resource Bank and Citi both
   listed? (Determines whether the community bank drops to CSV tier.)
2. Same Neon project as client data, or separate? (§4 privacy note.)
3. Low-balance floor and large-transaction threshold — real numbers, or start
   with $500/$500 and tune?
4. Are any of these joint/household accounts where someone else's activity
   appears? (Doesn't change the build; changes how noisy §5's large-transaction
   flag will be.)
