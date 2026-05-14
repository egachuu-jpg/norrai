# Norr AI Chief of Staff — Deployment

FastAPI service. Receives commands via Slack DM and Twilio SMS, runs them through Claude Sonnet with tools wired to Neon.

---

## Deploy to Railway

### 1. Apply the database migration

```bash
psql $DATABASE_URL -f db/migrations/003_cos_sessions.sql
```

### 2. Create the Railway service

1. railway.app → **New Project** → **Deploy from GitHub repo**
2. Select the `norrai` repo
3. Set **Root Directory** to `cos/`
4. Railway auto-detects Python from `requirements.txt` — no Dockerfile needed

### 3. Set environment variables

In Railway → your service → **Variables**, add everything from `.env.example`:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `DATABASE_URL` | Neon dashboard → Connection string (pooled) |
| `SLACK_BOT_TOKEN` | api.slack.com/apps → your app → OAuth & Permissions |
| `SLACK_SIGNING_SECRET` | api.slack.com/apps → your app → Basic Information |
| `TWILIO_ACCOUNT_SID` | console.twilio.com |
| `TWILIO_AUTH_TOKEN` | console.twilio.com |
| `GITHUB_PAT` | github.com → Settings → Developer settings → Fine-grained tokens → `norrai-n8n-read` (Contents: Read-only on egachuu-jpg/norrai) |

### 4. Get your public URL

Railway assigns a URL like `https://norrai-cos-production.up.railway.app`. Find it under **Settings → Networking → Public URL** (or generate one there if it's not already public).

### 5. Wire up Slack

1. api.slack.com/apps → your app → **Event Subscriptions** → enable
2. Request URL: `https://<your-railway-url>/slack/events`
3. Slack will send a challenge request — the server handles it automatically
4. Under **Subscribe to bot events** → add `message.im`
5. **OAuth & Permissions** → Bot Token Scopes → add `chat:write`, `im:history`, `im:read`
6. Reinstall the app to your workspace

### 6. Wire up Twilio

1. console.twilio.com → Phone Numbers → your COS number
2. **Messaging → A message comes in** → Webhook → `https://<your-railway-url>/sms/inbound`
3. Method: HTTP POST

---

## Running locally

```bash
cd cos
cp .env.example .env       # fill in your values
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Use [ngrok](https://ngrok.com) or [cloudflared tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose localhost for Slack/Twilio testing:

```bash
ngrok http 8000
# paste the https URL into Slack Event Subscriptions and Twilio webhook
```

---

## Health check

```
GET /health → {"ok": true}
```
