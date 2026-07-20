# Hermes VPS Provisioning Guide

Chief of Staff personal agent, on a minimal droplet separate from the Norr AI
box, connected to Telegram and the cos API. Software is
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) —
see `hermes/VERSION` for the exact pin. This replaces the earlier
generic-installer draft of this doc with the actual CLI surface, confirmed
against a working install (`hermes --help`, `hermes gateway --help`,
`hermes skills --help`, `hermes pairing --help`, `hermes cron --help`) rather
than assumed.

---

## Prerequisite — the cos API must be deployed and reachable FIRST

Every acceptance test below round-trips through the cos API, so it has to
exist before the droplet work can finish. Deployment steps live in
`decisions-pending/README.md § Deploying the API (Railway)`: apply
`sql/001_schema.sql` to the real Neon DB, set the `cos_api` role password,
deploy the API as a second Railway service (Root Directory =
`decisions-pending`), generate `COS_API_TOKEN`, and verify `/health` +
one authed `/pending` call. Bring two values from that step to step 7
below: the Railway URL (`COS_API_BASE`) and the token.

---

## Provisioning Checklist

### 0. Clear the stale `~/.hermes` copy (existing droplet only)

The DigitalOcean droplet (`ubuntu-s-1vcpu-1gb-nyc1`) already has a
`~/.hermes` directory — an orphaned copy of the Mac install's runtime state
(scp'd over at some point; the `._*` AppleDouble files are the tell), with
**no Hermes software behind it**. It contains a 25-category marketplace
skill tree (`red-teaming`, `mcp`, `github`, `social-media`, …) plus curator
state. A fresh install would adopt all of it, silently violating the
"cos-assistant only, no browsing, minimal capability" posture — so it goes
first:

```bash
mv ~/.hermes ~/hermes-stale-backup-$(date +%Y%m%d)   # keep a copy until the new install is confirmed
rm -f ~/._.hermes ~/._skills                          # Mac transfer artifacts
```

Delete the backup once the acceptance checklist at the bottom passes.

### 1. Infrastructure Setup

- [ ] Droplet already exists (`ubuntu-s-1vcpu-1gb-nyc1`, 1 vCPU/1GB) — at the
  spec's stated 2GB minimum it's undersized on RAM; try it first (the
  gateway is mostly idle), and resize in place via the DigitalOcean panel if
  the install or gateway OOMs. Note the "System restart required" banner —
  reboot before installing, not after.
  - Firewall: no inbound ports except SSH (restrict to your IP)
- [ ] Install Docker (`apt install docker.io` or the official Docker repo) —
  required for the terminal/tool-execution sandbox in step 6; confirmed NOT
  present on this droplet (`which docker` came back empty).

### 2. Clone + Install

```bash
git clone https://github.com/NousResearch/hermes-agent.git
cd hermes-agent
git checkout 43e566f77eaf01293086eb7cb99a21e240d60634   # matches hermes/VERSION pin
./setup-hermes.sh   # installs uv, creates venv, installs .[all], symlinks ~/.local/bin/hermes
```

- [ ] Confirm `hermes version` runs and matches the pin in `hermes/VERSION`.
  If you deliberately install a newer commit instead, update `hermes/VERSION`
  with the new commit/tag/version — see PRD §6.3, upgrades are manual only,
  after reviewing `RELEASE_v*.md` in the repo.

### 3. Model / Provider

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # set before the next command, or via `hermes login`
hermes config set model.default claude-sonnet-4-6
hermes config set model.provider anthropic
```

- [ ] Provider `anthropic`, model **`claude-sonnet-4-6`** — chosen over
  `claude-opus-4-8` for cost, since Hermes's actual usage volume here is a
  handful of Telegram messages a day plus one digest fetch. Anthropic is a
  first-class provider here — no OpenRouter proxy needed.
  - ⚠️ **`claude-sonnet-5` does not exist** in the model registry (an earlier
    draft of this doc named it — that was wrong). Setting a bogus model id
    silently falls back / errors at first message. Confirm with
    `hermes config show` → Model line reads `claude-sonnet-4-6`.

### 4. Telegram Gateway

```bash
hermes gateway setup      # interactive: choose Telegram, paste BotFather token
hermes gateway install    # generates the systemd service (Linux equivalent
                          # of the launchd plist a Mac/macOS install gets)
hermes gateway start
hermes gateway status
```

- [ ] Create the bot via BotFather first if you're using a fresh bot (decided:
  yes — see chat) and paste its token during `gateway setup`.

### 5. Access Control (`TELEGRAM_ALLOWED_USERS`, NOT pairing)

⚠️ **`hermes pairing` is NOT the DM access control in this build.** An earlier
draft of this doc claimed pairing gates who can DM the bot — it does not. With
pairing "approved" the bot still replied to anyone. The real gate is the
`TELEGRAM_ALLOWED_USERS` env var (comma-separated numeric Telegram user IDs)
in `~/.hermes/.env`:

- [ ] Find your numeric Telegram user ID (DM `@userinfobot`, or check the
  gateway log after you first message the bot).
- [ ] Add it to `~/.hermes/.env`:
  ```bash
  echo 'TELEGRAM_ALLOWED_USERS=<your_numeric_id>' >> ~/.hermes/.env
  hermes gateway restart
  ```
- [ ] **Verify with a negative test:** the bot must go silent for any ID not
  in the list. Confirmed working: bogus ID → silence; real ID → reply. For a
  single-user box this is the whole access model.
- [ ] For a Telegram DM, chat_id == user_id — this same numeric ID is reused
  in step 6b (the persona prompt is keyed on it).

### 6a. Terminal Backend — **local**, NOT Docker

⚠️ **Do NOT use the Docker sandbox backend.** An earlier draft required it.
In practice the Docker sandbox **isolates environment variables**, so
`$COS_API_TOKEN` / `$COS_API_BASE` from `~/.hermes/.env` are empty inside the
container and every cos API `curl` fails (the agent then hallucinates success).
Use the **local** backend:

```bash
hermes config set terminal.backend local
```

- [ ] Note: even with the local backend, the terminal subprocess does **not**
  auto-inherit `~/.hermes/.env`. The skill compensates by prefixing every
  command with `source /root/.hermes/.env &&` — see
  `hermes/skills/cos-assistant/SKILL.md`. Keep that pattern.

### 6b. Disable shadowing toolsets (critical for skill routing)

The agent has built-in toolsets whose verbs collide with the skill's — a bare
`list` / `track` gets grabbed by `cronjob`, `todo`, or `kanban`, and `memory`
lets the agent fabricate a task list from conversation history instead of
calling the API. Disable them on **both** platforms (`hermes tools disable`
defaults to `--platform cli`, so run each twice):

```bash
for t in cronjob todo memory; do
  hermes tools disable "$t" --platform telegram
  hermes tools disable "$t"
done
```

- [ ] Leave `terminal` and `skills` enabled (the skill needs both). `web`,
  `browser`, `image_gen`, `computer_use`, etc. should already be off.
- [ ] `kanban` is config-listed but not a toggleable toolset (`tools disable
  kanban` → "Unknown toolset"); disabling `memory`/`todo`/`cronjob` is what
  matters.

### 6c. Persona prompt — pin the agent to the cos-assistant skill

⚠️ **Without this, skill routing fails even with the shadow tools gone.** On a
bare `list` the agent defaults to *listing skills* rather than loading
cos-assistant. The fix is a per-chat system prompt (`telegram.channel_prompts`
keyed on your numeric Telegram ID from step 5) that hard-wires the verbs to the
skill:

```bash
CHAT=$(grep TELEGRAM_ALLOWED_USERS ~/.hermes/.env | cut -d= -f2 | tr -d ' "' | cut -d, -f1)
hermes config set telegram.channel_prompts.$CHAT "You are Egan's Chief of Staff running on a single-purpose appliance. Your ONLY job is managing pending decisions through the cos-assistant skill. For ANY of these requests — list, what is pending, show decisions, track, add, done, complete, snooze, defer, dismiss, ignore, draft — you MUST load the cos-assistant skill and call the cos API with a terminal curl. The word 'list' ALWAYS means GET /pending on the cos API. It NEVER means listing skills, and NEVER means hermes cron. Do not use cron, kanban, or memory tools. Never answer about tasks or decisions from conversation history — always call the cos API fresh."
```

- [ ] Verify it landed: `grep -A2 channel_prompts ~/.hermes/config.yaml` shows
  your ID mapped to the prompt. Restart the gateway after.
- [ ] After any change here, start a **fresh Telegram thread** (`/new`) before
  testing — a poisoned session anchors the old (wrong) interpretation of
  `list` and resumes it across gateway restarts.

### 7. Environment Secrets

Three permitted secrets, same as the spec (PRD §6.1) — `ANTHROPIC_API_KEY`
goes in via step 3 / `hermes login`; the Telegram bot token goes in via
`hermes gateway setup` (step 4), not a raw env var. Add the two cos-specific
ones to the same env file the setup wizard created (check `hermes config` /
`hermes doctor` to find its exact path if unsure — the Mac install used
`~/.hermes/.env`):

```bash
COS_API_TOKEN=...                       # generated per decisions-pending/README.md runbook
COS_API_BASE=https://<service>.up.railway.app   # from the Railway deploy (see Prerequisite)
```

- [ ] **Never commit to git or hardcode in Hermes config.**

### 8. Install the cos-assistant Skill

Skills are plain directories under `~/.hermes/skills/` (confirmed structure:
each skill = one directory containing a `SKILL.md` with YAML frontmatter —
`name`/`description`/`version`/`platforms`/`metadata.hermes.tags`; ours now
has this, see `hermes/skills/cos-assistant/SKILL.md`).

```bash
cp -r hermes/skills/cos-assistant ~/.hermes/skills/cos-assistant
hermes skills list      # confirm it's recognized
hermes skills config    # enable it; disable/leave-off anything unneeded
```

- [ ] Restart the gateway after adding the skill: `hermes gateway restart`.
- [ ] Test: DM "what's pending" → should return a cos API response.

### 9. Digest Delivery (built-in cron, not system crontab)

This project has its own scheduler (`hermes cron`) — use it instead of a
system crontab entry:

```bash
hermes cron create
```

- [ ] Configure (interactively, in natural language per this project's own
  convention): schedule `0 7 * * *`, timezone `America/Chicago`, action
  "`GET {COS_API_BASE}/digest/latest` with `Authorization: Bearer
  $COS_API_TOKEN`, send the response text to Telegram **verbatim** — do not
  rewrite, summarize, or decorate it. If 404 (no digest yet), skip silently
  and don't retry until the next scheduled run."
- [ ] Verify: `hermes cron list` shows the job; `hermes cron status` shows
  the scheduler is running.

### 10. Security Audit

```bash
bash scripts/audit_vps.sh
```

- [ ] Must output `AUDIT CLEAN — only permitted secrets found`. If not,
  remove the offending secret and re-run until clean.
- [ ] Run after every Hermes upgrade too (`hermes update` bumps the pinned
  commit — update `hermes/VERSION` immediately after and re-audit).

### 11. Backup

Native backup command, not a hand-rolled tar job:

```bash
hermes backup   # produces a zip of the Hermes home directory
```

- [ ] Check `hermes backup --help` for a built-in schedule flag; if there
  isn't one, wrap this in a thin system cron entry (not `hermes cron`, which
  is for agent-delivered tasks) that runs it nightly and ships the zip to
  the Norr AI box or object storage via `scp`/`rclone`.
- [ ] Restore path: `hermes import <backup.zip>`.

---

## Acceptance Checklist

- [ ] Send to Telegram: `"track: test item by next Friday"`
  → row created in cos API; position assigned for tomorrow's digest
- [ ] Send to Telegram: `"list"`
  → all pending items rendered with positions, including the test item
- [ ] Send to Telegram: `"done 1"` (or the test item's position)
  → item marked complete; no longer appears in `"list"`
- [ ] Trigger the digest (`hermes cron run <job>` or wait for 07:00 CT)
  → digest text arrives verbatim from `GET /digest/latest`
- [ ] Send to Telegram: `"snooze 2 to Thursday"`
  → item deferred, confirmed in `"list"`
- [ ] Access control: from a **different** Telegram account (ID not in
  `TELEGRAM_ALLOWED_USERS`), DM the bot → it stays silent. (There is no
  `hermes pairing` gate — see step 5.)

> **Note on by-position tests:** `done N` / `snooze N` / `dismiss N` resolve
> against *today's* `digest_log.item_ids` snapshot. Until the digest-generation
> workflow (n8n) exists, no digest row is written automatically, so these
> return "no digest yet today." To validate the path before then, seed one row:
> `INSERT INTO cos.digest_log (rendered_text, item_ids, model) VALUES ('...',
> ARRAY['<id1>','<id2>']::uuid[], 'manual-test-seed');` — positions map 1:1 to
> `item_ids` order.

---

## After Provisioning

- Keep `hermes/VERSION` updated on every upgrade (`hermes update` then
  re-pin commit/tag/version here)
- Run `scripts/audit_vps.sh` monthly and after every upgrade
- `hermes status` / `hermes doctor` for a quick health check
- `hermes cron status`, `hermes gateway status` to confirm both the digest
  scheduler and the Telegram gateway are actually running — not just
  installed
- Test the full pipeline monthly: track → list → digest delivery →
  done/snooze/dismiss

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| Telegram: no response to commands | `hermes gateway status`; is your numeric ID in `TELEGRAM_ALLOWED_USERS` (step 5)? |
| Bot replies but ignores the skill (lists skills / cron jobs, or invents a task list) | Shadow toolsets or missing persona — verify step 6b (`memory`/`todo`/`cronjob` disabled) and step 6c (`channel_prompts` set); then `/new` for a fresh thread |
| cos API 401 | `COS_API_TOKEN` mismatch — check `~/.hermes/.env` |
| cos API 500 on first call after idle | Railway cold-start on the DB pool — retry once; it warms up (not a code bug) |
| Bot claims curl worked but DB is empty | Terminal subprocess env not sourced — every curl must be prefixed `source /root/.hermes/.env &&` (step 6a) |
| `done N`/`snooze N`/`dismiss N` → "no digest yet today" | No `digest_log` row for today — expected until the n8n digest workflow exists; seed one to test (see Acceptance note) |
| Skill not responding | `hermes skills list` (enabled?); `hermes gateway restart` after any skill change |
| Audit script fails | Remove the offending secret; retry; check `HERMES_HOME` if paths look wrong |
