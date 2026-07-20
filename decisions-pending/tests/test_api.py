"""Pytest suite for the cos API (Task A2).

Uses the shared `db` fixture from conftest.py (autocommit psycopg connection,
tables truncated per test) plus a per-test `client` fixture that runs the
FastAPI app's lifespan so the connection pool picks up COS_DB_URL/COS_API_TOKEN.
"""

from __future__ import annotations

import os
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from api.main import app

TOKEN = os.environ["COS_API_TOKEN"]
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture()
def client(db):
    # depending on `db` guarantees tables are truncated before the app's
    # pool is created/used for this test.
    with TestClient(app) as c:
        yield c


def today_chicago(db):
    with db.cursor() as cur:
        cur.execute("SELECT cos.today_chicago()")
        return cur.fetchone()[0]


# --------------------------------------------------------------------------
# 1. auth
# --------------------------------------------------------------------------


def test_health_requires_no_auth():
    with TestClient(app) as c:
        r = c.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


def test_missing_auth_header_401(client):
    r = client.get("/pending")
    assert r.status_code == 401


def test_wrong_auth_token_401(client):
    r = client.get("/pending", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_malformed_auth_header_401(client):
    r = client.get("/pending", headers={"Authorization": TOKEN})  # missing "Bearer "
    assert r.status_code == 401


# --------------------------------------------------------------------------
# 2. happy path per endpoint
# --------------------------------------------------------------------------


def test_create_decision_happy_path(client):
    r = client.post("/decisions", json={"title": "Renew LLC filing"}, headers=AUTH)
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Renew LLC filing"
    assert data["status"] == "open"
    assert data["source"] == "manual"
    assert data["urgency"] == "normal"
    assert data["lead_days"] == 7
    assert data["owner"] == "egan"
    # source_ref must be a str(uuid4())
    uuid.UUID(data["source_ref"])


def test_create_decision_with_overrides(client):
    r = client.post(
        "/decisions",
        json={
            "title": "Ping insurer",
            "deadline": "2026-08-01",
            "urgency": "high",
            "lead_days": 3,
            "consequence": "policy lapses",
            "detail": "call before renewal",
            "owner": "egan",
        },
        headers=AUTH,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["urgency"] == "high"
    assert data["lead_days"] == 3
    assert data["deadline"] == "2026-08-01"
    assert data["consequence"] == "policy lapses"


def test_pending_ordering_and_digest_position(client):
    client.post("/decisions", json={"title": "Low", "urgency": "low"}, headers=AUTH)
    client.post("/decisions", json={"title": "Critical", "urgency": "critical"}, headers=AUTH)
    client.post("/decisions", json={"title": "High", "urgency": "high"}, headers=AUTH)
    client.post("/decisions", json={"title": "Normal", "urgency": "normal"}, headers=AUTH)

    r = client.get("/pending", headers=AUTH)
    assert r.status_code == 200
    items = r.json()
    titles = [i["title"] for i in items]
    assert titles == ["Critical", "High", "Normal", "Low"]
    assert [i["digest_position"] for i in items] == [1, 2, 3, 4]


def test_pending_owner_filter(client):
    client.post("/decisions", json={"title": "Egan item"}, headers=AUTH)
    client.post("/decisions", json={"title": "Other item", "owner": "someone-else"}, headers=AUTH)

    r = client.get("/pending", params={"owner": "egan"}, headers=AUTH)
    assert r.status_code == 200
    items = r.json()
    assert all(i["owner"] == "egan" for i in items)
    titles = [i["title"] for i in items]
    assert "Egan item" in titles
    assert "Other item" not in titles


def test_done_happy_path(client):
    created = client.post("/decisions", json={"title": "Finish thing"}, headers=AUTH).json()
    r = client.post(f"/decisions/{created['id']}/done", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "done"
    assert body["resolved_at"] is not None
    assert body["id"] == created["id"]


def test_dismiss_happy_path(client):
    created = client.post("/decisions", json={"title": "Dismiss me"}, headers=AUTH).json()
    r = client.post(f"/decisions/{created['id']}/dismiss", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "dismissed"
    assert body["resolved_at"] is not None


def test_snooze_happy_path(client, db):
    created = client.post("/decisions", json={"title": "Snooze me"}, headers=AUTH).json()
    future = (today_chicago(db) + timedelta(days=3)).isoformat()
    r = client.post(f"/decisions/{created['id']}/snooze", json={"until": future}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "open"
    assert body["snoozed_until"] == future


def test_draft_404_when_missing_then_200(client, db):
    created = client.post("/decisions", json={"title": "Email item"}, headers=AUTH).json()

    r = client.get(f"/decisions/{created['id']}/draft", headers=AUTH)
    assert r.status_code == 404

    with db.cursor() as cur:
        cur.execute(
            "UPDATE cos.pending_decisions SET draft_reply = %s WHERE id = %s",
            ("Sounds good, will confirm Thursday.", created["id"]),
        )

    r2 = client.get(f"/decisions/{created['id']}/draft", headers=AUTH)
    assert r2.status_code == 200
    assert r2.json() == {"draft_reply": "Sounds good, will confirm Thursday."}


def test_digest_latest_404_then_200(client, db):
    dec = client.post("/decisions", json={"title": "Digest item"}, headers=AUTH).json()

    r = client.get("/digest/latest", headers=AUTH)
    assert r.status_code == 404

    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO cos.digest_log (rendered_text, item_ids, model) VALUES (%s, %s, %s)",
            ("Good morning. 1 item pending.", [uuid.UUID(dec["id"])], "test-model"),
        )

    r2 = client.get("/digest/latest", headers=AUTH)
    assert r2.status_code == 200
    body = r2.json()
    assert body["rendered_text"] == "Good morning. 1 item pending."
    assert "sent_at" in body


def test_by_position_resolves_and_stays_stable(client, db):
    d1 = client.post("/decisions", json={"title": "First"}, headers=AUTH).json()
    d2 = client.post("/decisions", json={"title": "Second"}, headers=AUTH).json()
    d3 = client.post("/decisions", json={"title": "Third"}, headers=AUTH).json()

    item_ids = [uuid.UUID(d["id"]) for d in (d1, d2, d3)]
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO cos.digest_log (rendered_text, item_ids, model) VALUES (%s, %s, %s)",
            ("digest", item_ids, "test-model"),
        )

    # complete item 2 by position
    r_second = client.post("/decisions/by-position/2/done", headers=AUTH)
    assert r_second.status_code == 200
    assert r_second.json()["id"] == d2["id"]
    assert r_second.json()["status"] == "done"

    # position 3 must still resolve to the third original id, unaffected by
    # item 2 having left v_surfaced
    r_third = client.post("/decisions/by-position/3/dismiss", headers=AUTH)
    assert r_third.status_code == 200
    assert r_third.json()["id"] == d3["id"]
    assert r_third.json()["status"] == "dismissed"


def test_by_position_no_digest_today_404(client):
    r = client.post("/decisions/by-position/1/done", headers=AUTH)
    assert r.status_code == 404


def test_by_position_out_of_range_404(client, db):
    d1 = client.post("/decisions", json={"title": "Only one"}, headers=AUTH).json()
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO cos.digest_log (rendered_text, item_ids, model) VALUES (%s, %s, %s)",
            ("digest", [uuid.UUID(d1["id"])], "test-model"),
        )
    r = client.post("/decisions/by-position/5/done", headers=AUTH)
    assert r.status_code == 404


def test_by_position_snooze(client, db):
    d1 = client.post("/decisions", json={"title": "Snoozable"}, headers=AUTH).json()
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO cos.digest_log (rendered_text, item_ids, model) VALUES (%s, %s, %s)",
            ("digest", [uuid.UUID(d1["id"])], "test-model"),
        )
    future = (today_chicago(db) + timedelta(days=2)).isoformat()
    r = client.post("/decisions/by-position/1/snooze", json={"until": future}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()["id"] == d1["id"]
    assert r.json()["snoozed_until"] == future


# --------------------------------------------------------------------------
# 3. double done -> 409 with current status
# --------------------------------------------------------------------------


def test_double_done_returns_409_with_status(client):
    created = client.post("/decisions", json={"title": "Only once"}, headers=AUTH).json()
    r1 = client.post(f"/decisions/{created['id']}/done", headers=AUTH)
    assert r1.status_code == 200

    r2 = client.post(f"/decisions/{created['id']}/done", headers=AUTH)
    assert r2.status_code == 409
    assert r2.json()["detail"] == {"error": "not open", "status": "done"}


def test_snooze_after_dismiss_returns_409(client):
    created = client.post("/decisions", json={"title": "Dismissed thing"}, headers=AUTH).json()
    client.post(f"/decisions/{created['id']}/dismiss", headers=AUTH)

    r = client.post(
        f"/decisions/{created['id']}/snooze",
        json={"until": "2030-01-01"},
        headers=AUTH,
    )
    assert r.status_code == 409
    assert r.json()["detail"]["status"] == "dismissed"


# --------------------------------------------------------------------------
# 4. snooze with past date -> 422
# --------------------------------------------------------------------------


def test_snooze_past_date_returns_422(client, db):
    created = client.post("/decisions", json={"title": "Snooze me"}, headers=AUTH).json()
    past = (today_chicago(db) - timedelta(days=1)).isoformat()
    r = client.post(f"/decisions/{created['id']}/snooze", json={"until": past}, headers=AUTH)
    assert r.status_code == 422


def test_decision_not_found_404(client):
    r = client.post(f"/decisions/{uuid.uuid4()}/done", headers=AUTH)
    assert r.status_code == 404


# --------------------------------------------------------------------------
# 6. every mutation (including a failed 409 call) logs to command_log
# --------------------------------------------------------------------------


def test_command_log_written_for_success_and_failure(client, db):
    created = client.post("/decisions", json={"title": "Logged item"}, headers=AUTH).json()
    decision_id = uuid.UUID(created["id"])

    r_done = client.post(f"/decisions/{created['id']}/done", headers=AUTH)
    assert r_done.status_code == 200

    r_conflict = client.post(f"/decisions/{created['id']}/done", headers=AUTH)
    assert r_conflict.status_code == 409

    with db.cursor() as cur:
        cur.execute(
            "SELECT applied, error, decision_id FROM cos.command_log"
            " WHERE decision_id = %s ORDER BY created_at",
            (decision_id,),
        )
        rows = cur.fetchall()

    # create (applied) + done (applied) + done-conflict (not applied) = 3
    assert len(rows) == 3
    assert rows[0][0] is True
    assert rows[1][0] is True
    assert rows[2][0] is False
    assert rows[2][1] is not None  # error populated on the failed call


def test_command_log_written_for_by_position_not_found(client, db):
    r = client.post("/decisions/by-position/1/done", headers=AUTH)
    assert r.status_code == 404

    with db.cursor() as cur:
        cur.execute(
            "SELECT applied, error, decision_id FROM cos.command_log"
            " WHERE parsed_action ->> 'path' = %s",
            ("/decisions/by-position/1/done",),
        )
        rows = cur.fetchall()

    assert len(rows) == 1
    assert rows[0][0] is False
    assert rows[0][2] is None  # decision_id unknown -- no digest today at all
