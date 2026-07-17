# Decisions Pending — personal chief of staff

The system that owes Egan one message a day: a 7am Telegram digest of every
decision pending, plus five verbs to act on them (`done`, `snooze`, `dismiss`,
`draft`, `track`). Spec: `decisions-pending dev spec` (companion to
decisions-pending-prd.md v2).

## Architecture (locked)

- **Data plane** (Norr AI box): Postgres schema `cos`, the FastAPI **cos API**
  (this directory, `api/`), and n8n collectors that write directly to Postgres.
- **Conversational plane** (separate minimal VPS): Hermes + Telegram. Holds
  exactly three secrets: LLM key, Telegram bot token, `COS_API_TOKEN`. All it
  can do is call the cos API.
- Digest is rendered in the data plane (n8n → Fable 5) and stored in
  `cos.digest_log`; Hermes only fetches `/digest/latest` at 7:00 CT and
  delivers it verbatim.

## Layout deviations from the dev spec

- The spec assumed a standalone repo named `cos/`. This lives in the norrai
  monorepo as `decisions-pending/` because `cos/` is already the deployed
  Railway business-assistant service (see `PRD/cos-v2-internal.md`) — a
  different system. Internal layout matches the spec.
- CI is `.github/workflows/decisions-pending-ci.yml` at the repo root.

## Schema provenance

`decisions-pending-prd.md` (with the canonical §7 DDL) is not checked into
this repo; `sql/001_schema.sql` was reconstructed from every schema reference
in the dev spec (tables `pending_decisions`, `command_log`, `digest_log`,
`decision_rules`, view `v_surfaced`, plus the Task A1/A4 column additions
`draft_reply`, `nag_pending`, `escalated_at`). If the PRD's DDL differs,
reconcile before first production deploy.

## Running tests

```bash
cd decisions-pending
docker compose up -d          # disposable Postgres 17 on :5439
pip install -r requirements-dev.txt
pytest
```

`COS_TEST_DB_URL` overrides the default DSN
(`postgresql://postgres:postgres@localhost:5439/cos_test`).

## Running the API

```bash
cp .env.example .env          # fill in COS_DB_URL + COS_API_TOKEN
uvicorn api.main:app --host 127.0.0.1 --port 8100
```

## Deploying the API (Railway)

The spec's "Norr AI box" is, in this stack, Railway — the same platform
already hosting the `cos/` business bot. Deploy this API as a **second
Railway service** in that project (never merged into the existing one —
different credentials, different blast radius):

1. New service from this repo, **Root Directory = `decisions-pending`**
   (the `Procfile` here runs `uvicorn api.main:app`).
2. Variables: `COS_DB_URL` (the Neon DSN **as the `cos_api` role**, not the
   owner role — `postgresql://cos_api:<password>@<neon-host>/neondb?sslmode=require`)
   and `COS_API_TOKEN` (`openssl rand -hex 32`; same value goes to the
   Hermes VPS later).
3. Apply the schema first (below) or the pool will connect and every query
   will 42P01.
4. Verify: `curl https://<service>.up.railway.app/health` → `{"status":"ok"}`,
   then one authed call:
   `curl -H "Authorization: Bearer $COS_API_TOKEN" https://<service>.up.railway.app/pending` → `[]`.

Hermes then gets `COS_API_BASE=https://<service>.up.railway.app` — HTTPS over
the public internet with the bearer token is the intended posture (the
droplet's only outbound dependencies stay "cos API + Telegram + Anthropic").

## Applying the schema (production)

```bash
psql "$ADMIN_DB_URL" -f sql/001_schema.sql        # idempotent
psql "$ADMIN_DB_URL" -c "ALTER ROLE cos_api PASSWORD '<openssl rand -hex 32>'"
```

The `cos_api` role has SELECT/INSERT/UPDATE on `pending_decisions` +
`command_log`, SELECT on `digest_log` + `v_surfaced`, **no DELETE anywhere,
no access outside the cos schema**.

## Runbook

- **Token rotation (quarterly):** generate a new `COS_API_TOKEN`
  (`openssl rand -hex 32`), set it in the API's env and restart, then update
  the single copy on the Hermes VPS. One client, so no overlap window needed —
  a minute of 401s is fine.
- **Hermes upgrade:** manual only, after changelog review. Snapshot first,
  upgrade, update `hermes/VERSION`, then run `scripts/audit_vps.sh` — it must
  find only the three permitted secrets.
- **Restore from snapshot:** untar the nightly Hermes home-dir snapshot over a
  fresh install of the pinned version in `hermes/VERSION`, re-run the audit
  script, send a test `track:` from Telegram.

See `hermes/skills/cos-assistant/SKILL.md` for the Hermes-side contract and
`n8n/README.md` in this directory for the collector workflows.
