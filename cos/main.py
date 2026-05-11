import hashlib
import hmac
import json
import os
import time

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from slack_sdk import WebClient
from twilio.request_validator import RequestValidator

load_dotenv()

import agent
import db

app = FastAPI()

_slack = WebClient(token=os.environ["SLACK_BOT_TOKEN"])
_twilio_validator = RequestValidator(os.environ["TWILIO_AUTH_TOKEN"])


# ---------------------------------------------------------------------------
# Slack
# ---------------------------------------------------------------------------

def _verify_slack(body_bytes: bytes, timestamp: str, signature: str) -> bool:
    if abs(time.time() - int(timestamp)) > 300:
        return False
    sig_base = f"v0:{timestamp}:{body_bytes.decode()}"
    computed = "v0=" + hmac.new(
        os.environ["SLACK_SIGNING_SECRET"].encode(),
        sig_base.encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(computed, signature)


def _handle_slack_dm(user_id: str, text: str, channel: str) -> None:
    history = db.load_session(user_id, "slack")
    reply, updated = agent.run_turn(history, text)
    db.save_session(user_id, "slack", updated)
    _slack.chat_postMessage(channel=channel, text=reply)


@app.post("/slack/events")
async def slack_events(request: Request, background_tasks: BackgroundTasks):
    body_bytes = await request.body()
    timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
    signature = request.headers.get("X-Slack-Signature", "")

    if not _verify_slack(body_bytes, timestamp, signature):
        raise HTTPException(status_code=403, detail="Invalid Slack signature")

    payload = json.loads(body_bytes)

    # Slack sends a one-time URL verification challenge on app setup
    if payload.get("type") == "url_verification":
        return JSONResponse({"challenge": payload["challenge"]})

    event = payload.get("event", {})

    # Only handle DMs; ignore bot messages and message edits
    if (
        event.get("type") == "message"
        and event.get("channel_type") == "im"
        and not event.get("bot_id")
        and not event.get("subtype")
    ):
        background_tasks.add_task(
            _handle_slack_dm,
            user_id=event["user"],
            text=event.get("text", ""),
            channel=event["channel"],
        )

    # Slack requires a 200 within 3 seconds — reply immediately, process in background
    return JSONResponse({"ok": True})


# ---------------------------------------------------------------------------
# Twilio SMS
# ---------------------------------------------------------------------------

@app.post("/sms/inbound")
async def sms_inbound(request: Request):
    form_data = await request.form()
    body = dict(form_data)

    url = str(request.url)
    signature = request.headers.get("X-Twilio-Signature", "")
    if not _twilio_validator.validate(url, body, signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    from_number: str = body.get("From", "")
    message_text: str = body.get("Body", "").strip()

    if not message_text:
        return Response(content="<Response/>", media_type="application/xml")

    history = db.load_session(from_number, "sms")
    reply, updated = agent.run_turn(history, message_text)
    db.save_session(from_number, "sms", updated)

    # TwiML reply — SMS has a 1600-char limit
    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<Response><Message>{reply[:1600]}</Message></Response>"
    )
    return Response(content=twiml, media_type="application/xml")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"ok": True}
