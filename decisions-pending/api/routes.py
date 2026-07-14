"""All cos API endpoints. Handlers are thin; the real logic lives in db.py."""

from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from . import auth, db
from .models import DecisionCreate, DecisionOut, DigestOut, DraftOut, PendingItem, SnoozeBody

# /health needs no auth; everything else does.
health_router = APIRouter()


@health_router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


router = APIRouter(dependencies=[Depends(auth.require_bearer_token)])


def _finalize_transition(
    conn,
    decision_id: Optional[UUID],
    path: str,
    body: Optional[dict[str, Any]],
    row: Optional[dict[str, Any]],
    err,
):
    """Shared tail end of every done/snooze/dismiss handler: log to
    command_log and either return the row or raise the right HTTP error."""
    if err is None:
        db.log_command(conn, decision_id=decision_id, method="POST", path=path, body=body, applied=True)
        return row

    if err == "not_found":
        db.log_command(
            conn, decision_id=None, method="POST", path=path, body=body,
            applied=False, error="not found",
        )
        raise HTTPException(status_code=404, detail={"error": "not found"})

    if err == "past_date":
        db.log_command(
            conn, decision_id=decision_id, method="POST", path=path, body=body,
            applied=False, error="until before today",
        )
        raise HTTPException(status_code=422, detail={"error": "until before today"})

    # ("conflict", current_status)
    _, current_status = err
    db.log_command(
        conn, decision_id=decision_id, method="POST", path=path, body=body,
        applied=False, error=f"not open: {current_status}",
    )
    raise HTTPException(status_code=409, detail={"error": "not open", "status": current_status})


def _resolve_position_or_raise(conn, n: int, path: str, body: Optional[dict[str, Any]]) -> UUID:
    """Resolve position n (1-based) against TODAY's latest digest_log row's
    item_ids. Positions stay stable all day even after items complete, so
    this looks at the digest snapshot, never at live v_surfaced."""
    digest = db.get_latest_digest_today(conn)
    if digest is None:
        db.log_command(
            conn, decision_id=None, method="POST", path=path, body=body,
            applied=False, error="no digest today",
        )
        raise HTTPException(status_code=404, detail={"error": "no digest today"})

    item_ids = digest["item_ids"]
    if n < 1 or n > len(item_ids):
        db.log_command(
            conn, decision_id=None, method="POST", path=path, body=body,
            applied=False, error="position out of range",
        )
        raise HTTPException(status_code=404, detail={"error": "position out of range"})

    return item_ids[n - 1]


@router.get("/pending", response_model=list[PendingItem])
def get_pending(owner: Optional[str] = None):
    with db.get_pool().connection() as conn:
        return db.list_pending(conn, owner)


@router.post("/decisions", response_model=DecisionOut, status_code=201)
def create_decision(body: DecisionCreate):
    payload = body.model_dump(mode="json")
    with db.get_pool().connection() as conn:
        row = db.create_decision(conn, body)
        db.log_command(
            conn, decision_id=row["id"], method="POST", path="/decisions",
            body=payload, applied=True,
        )
        return row


@router.post("/decisions/{decision_id}/done", response_model=DecisionOut)
def mark_done(decision_id: UUID):
    path = f"/decisions/{decision_id}/done"
    with db.get_pool().connection() as conn:
        row, err = db.transition_status(conn, decision_id, "done")
        return _finalize_transition(conn, decision_id, path, None, row, err)


@router.post("/decisions/{decision_id}/snooze", response_model=DecisionOut)
def snooze(decision_id: UUID, body: SnoozeBody):
    path = f"/decisions/{decision_id}/snooze"
    payload = body.model_dump(mode="json")
    with db.get_pool().connection() as conn:
        row, err = db.snooze_decision(conn, decision_id, body.until)
        return _finalize_transition(conn, decision_id, path, payload, row, err)


@router.post("/decisions/{decision_id}/dismiss", response_model=DecisionOut)
def dismiss(decision_id: UUID):
    path = f"/decisions/{decision_id}/dismiss"
    with db.get_pool().connection() as conn:
        row, err = db.transition_status(conn, decision_id, "dismissed")
        return _finalize_transition(conn, decision_id, path, None, row, err)


@router.get("/decisions/{decision_id}/draft", response_model=DraftOut)
def get_draft(decision_id: UUID):
    with db.get_pool().connection() as conn:
        row = db.get_decision(conn, decision_id)
    if row is None or row.get("draft_reply") is None:
        raise HTTPException(status_code=404, detail={"error": "not found"})
    return {"draft_reply": row["draft_reply"]}


@router.get("/digest/latest", response_model=DigestOut)
def digest_latest():
    with db.get_pool().connection() as conn:
        row = db.get_latest_digest_today(conn)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "no digest today"})
    return {"rendered_text": row["rendered_text"], "sent_at": row["sent_at"]}


@router.post("/decisions/by-position/{n}/done", response_model=DecisionOut)
def done_by_position(n: int):
    path = f"/decisions/by-position/{n}/done"
    with db.get_pool().connection() as conn:
        decision_id = _resolve_position_or_raise(conn, n, path, None)
        row, err = db.transition_status(conn, decision_id, "done")
        return _finalize_transition(conn, decision_id, path, None, row, err)


@router.post("/decisions/by-position/{n}/snooze", response_model=DecisionOut)
def snooze_by_position(n: int, body: SnoozeBody):
    path = f"/decisions/by-position/{n}/snooze"
    payload = body.model_dump(mode="json")
    with db.get_pool().connection() as conn:
        decision_id = _resolve_position_or_raise(conn, n, path, payload)
        row, err = db.snooze_decision(conn, decision_id, body.until)
        return _finalize_transition(conn, decision_id, path, payload, row, err)


@router.post("/decisions/by-position/{n}/dismiss", response_model=DecisionOut)
def dismiss_by_position(n: int):
    path = f"/decisions/by-position/{n}/dismiss"
    with db.get_pool().connection() as conn:
        decision_id = _resolve_position_or_raise(conn, n, path, None)
        row, err = db.transition_status(conn, decision_id, "dismissed")
        return _finalize_transition(conn, decision_id, path, None, row, err)
