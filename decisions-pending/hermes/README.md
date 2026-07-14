# Hermes VPS Provisioning Guide

Chief of Staff personal agent, separate minimal VPS connected to Telegram and Norr AI's cos API.

---

## Provisioning Checklist

### 1. Infrastructure Setup

- [ ] Provision minimal VPS (separate from Norr AI box)
  - 1–2 vCPU, 2GB RAM, 20GB disk minimum
  - Network: outbound HTTPS to cos API (Norr AI box) and Telegram API only
  - Firewall: NO inbound ports except SSH (restrict to your IP)

### 2. Hermes Installation

- [ ] Install Hermes via official installer ([link to latest installer](https://github.com/talkdai/hermes/releases))
  - Follow official setup wizard
  - Record the exact version number in `hermes/VERSION` after successful install

### 3. Version Pinning

- [ ] Open `hermes/VERSION` and replace `UNPINNED` with the exact version installed
  - Example: `v1.2.3 — installed 2026-07-14, upgraded manual changelog review`
  - Keep this updated on every upgrade; upgrades are manual (review changelog before upgrading)

### 4. LLM Backend Configuration

- [ ] Configure Anthropic backend in Hermes settings
  - Model: `claude-opus-4-8` or `claude-sonnet-4-6`
  - Set `ANTHROPIC_API_KEY` env var (see Step 7)

### 5. Telegram Integration

- [ ] Create Telegram bot with BotFather
  - Record bot token (will set in Step 7)
  - **Allowlist Egan's chat ID ONLY** — no other users can access this agent
  - Test that bot receives messages from Egan's chat

### 6. Tool Configuration

- [ ] Confirm **NO browsing tool** is enabled (Hermes should have zero web access)
  - Tools allowed: cos-assistant skill only
- [ ] Set terminal backend to Docker sandbox (never host shell)

### 7. Install cos-assistant Skill

- [ ] Skill path: `hermes/skills/cos-assistant/`
  - Hermes loads skills from its config directory
  - Restart Hermes after adding the skill
  - Test: say "what's pending" in Telegram → should return cos API response

### 8. Environment Secrets

- [ ] Set three environment variables on the Hermes VPS (in systemd service or shell profile)
  ```bash
  export ANTHROPIC_API_KEY="sk-ant-..."
  export TELEGRAM_BOT_TOKEN="7890123456:ABCdef..."
  export COS_API_TOKEN="cos_secret_token_..."
  export COS_API_BASE="http://NORRAI_BOX:8100"  # internal IP or hostname
  ```
  - Store securely (e.g., systemd EnvironmentFile, `.env` in service wrapper, or AWS Secrets Manager)
  - **Never commit to git or hardcode in Hermes config**

### 9. Security Audit

- [ ] Run secrets audit from Norr AI box (requires SSH access to Hermes VPS)
  ```bash
  bash scripts/audit_vps.sh
  ```
  - Must output: `AUDIT CLEAN — only permitted secrets found`
  - If violations: remove unwanted secrets and re-run until clean
  - Run after every Hermes upgrade as well

### 10. Backup & Recovery

- [ ] Set up nightly snapshots of Hermes home directory
  - Example crontab (on Hermes VPS):
    ```bash
    # Daily 22:00 UTC backup to Norr AI box
    0 22 * * * tar -czf /tmp/hermes-backup-$(date +\%Y\%m\%d).tar.gz ~/.hermes && \
      scp /tmp/hermes-backup-$(date +\%Y\%m\%d).tar.gz backups@NORRAI_BOX:/backups/hermes/ && \
      rm /tmp/hermes-backup-*.tar.gz
    ```
  - Or use rclone to ship to object storage (S3, R2, etc.)

---

## Acceptance Checklist

Verify the system end-to-end before declaring done:

- [ ] Send to Telegram: `"track: test item by next Friday"`
  - Expected: Database row created in cos API; position assigned for tomorrow's digest
  
- [ ] Send to Telegram: `"list"`
  - Expected: All pending items rendered with positions (1, 2, 3, ...)
  - Includes the "test item" just created

- [ ] Send to Telegram: `"done 1"` (or the position of the test item)
  - Expected: Item marked complete; no longer appears in `"list"` output

- [ ] Wait or manually trigger digest generation (~07:00 America/Chicago)
  - Expected: Digest text arrives in Telegram verbatim from `GET /digest/latest`

- [ ] Send to Telegram: `"snooze 2 to Thursday"`
  - Expected: Item deferred to Thursday; confirm in `"list"` output

---

## After Provisioning

- Keep `hermes/VERSION` updated on every upgrade
- Run `scripts/audit_vps.sh` monthly and after every upgrade
- Monitor Hermes logs for API errors (include COS_API_BASE connection issues)
- Test the full pipeline monthly: track → list → digest delivery → done/snooze/dismiss

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| Telegram: "connection refused" | Confirm `TELEGRAM_BOT_TOKEN` is correct; check Telegram API status |
| Telegram: no response to commands | Confirm bot is in Egan's chat; verify Hermes service is running |
| cos API 401 | Check `COS_API_TOKEN`; confirm it's set in Hermes environment |
| cos API 404 on `/pending` | Confirm `COS_API_BASE` URL is reachable; check Norr AI box is online |
| Audit script fails | Remove offending secrets; retry; if persist, check `HERMES_HOME` path |
