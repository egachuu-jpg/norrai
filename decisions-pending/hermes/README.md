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

## Provisioning Checklist

### 1. Infrastructure Setup

- [ ] Provision minimal droplet (separate from the Norr AI box)
  - 1–2 vCPU, 2GB RAM, 20GB disk minimum
  - Firewall: no inbound ports except SSH (restrict to your IP)
- [ ] Install Docker (`apt install docker.io` or the official Docker repo) —
  required for the terminal/tool-execution sandbox in step 6, not present by
  default on a fresh droplet.

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
hermes model
```

- [ ] Select provider `anthropic`, model `claude-opus-4-8` (per the dev spec;
  `claude-sonnet-4-6` if you want the cheaper tier — either is acceptable).
  Anthropic is a first-class provider here (confirmed in `providers/README.md`
  of the repo) — no OpenRouter proxy needed.

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

### 5. Access Control (pairing, not a static allowlist)

This project's access control is DM-pairing, not a config-file chat-ID list:

- [ ] From your phone, DM the bot once — it will issue a pairing code.
- [ ] On the droplet: `hermes pairing list` (see the pending code) →
  `hermes pairing approve <code>`.
- [ ] Confirm no one else is approved: `hermes pairing list` should show
  exactly one approved user (you). `hermes pairing revoke <user>` removes
  anyone else; `hermes pairing clear-pending` clears any other pending codes
  before you approve yours, if you want to be extra sure nothing else got
  submitted first.

### 6. Tool Restriction

```bash
hermes tools
```

- [ ] Disable the browser/web tool and anything not needed for calling the
  cos API (bash/http execution is what actually runs the `curl` calls
  described in the skill — keep that; disable browsing, computer-use, and
  anything platform-specific you don't need).
- [ ] Set the terminal/tool-execution sandbox backend to **Docker** (one of
  seven backends this project supports — Local/Docker/SSH/Singularity/
  Modal/Daytona/Vercel Sandbox) via `hermes config` (interactive) — confirms
  the spec's "terminal backend = Docker sandbox" requirement. Requires
  Docker installed (step 1).

### 7. Environment Secrets

Three permitted secrets, same as the spec (PRD §6.1) — `ANTHROPIC_API_KEY`
goes in via step 3 / `hermes login`; the Telegram bot token goes in via
`hermes gateway setup` (step 4), not a raw env var. Add the two cos-specific
ones to the same env file the setup wizard created (check `hermes config` /
`hermes doctor` to find its exact path if unsure — the Mac install used
`~/.hermes/.env`):

```bash
COS_API_TOKEN=...                       # generated per decisions-pending/README.md runbook
COS_API_BASE=http://NORRAI_BOX:8100     # internal IP or hostname
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
- [ ] `hermes pairing list` shows exactly one approved user

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
| Telegram: no response to commands | `hermes gateway status`; `hermes pairing list` (are you actually approved?) |
| cos API 401 | `COS_API_TOKEN` mismatch — check wherever step 7's env file lives |
| cos API 404 on `/pending` | `COS_API_BASE` unreachable — confirm the Norr AI box is online |
| Digest never arrives | `hermes cron list` / `hermes cron status` — job created and scheduler running? |
| Skill not responding | `hermes skills list` (installed?); `hermes skills config` (enabled?); `hermes gateway restart` after any skill change |
| Audit script fails | Remove the offending secret; retry; check `HERMES_HOME` if paths look wrong |
| Terminal sandbox not using Docker | Docker installed? (`which docker`); recheck `hermes config`'s terminal-backend setting |
