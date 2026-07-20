"""psycopg3 connection pool + query helpers for the cos API.

All date comparisons in app logic go through cos.today_chicago() (never
CURRENT_DATE) since the Postgres server runs UTC and "today" for this app is
America/Chicago.
"""

from __future__ import annotations

import os
from datetime import date
from typing import Any, Optional
from uuid import UUID, uuid4

from psycopg.rows import dict_row
from psycopg.types.json import Json
from psycopg_pool import ConnectionPool

_pool: Optional[ConnectionPool] = None

# Urgency isn't alphabetically or numerically ordered in the DB, so every
# ORDER BY that needs "critical > high > normal > low" spells it out here.
_URGENCY_RANK_SQL = (
    "CASE urgency "
    "WHEN 'critical' THEN 4 "
    "WHEN 'high' THEN 3 "
    "WHEN 'normal' THEN 2 "
    "WHEN 'low' THEN 1 "
    "ELSE 0 END"
)

_SURFACED_ORDER_SQL = f"{_URGENCY_RANK_SQL} DESC, deadline ASC NULLS LAST"


def init_pool() -> ConnectionPool:
    """Create the pool. Must run at app startup (lifespan), not import time,
    so it picks up COS_DB_URL from the environment set by the caller/tests."""
    global _pool
    if _pool is None:
        dsn = os.environ["COS_DB_URL"]
        _pool = ConnectionPool(dsn, kwargs={"autocommit": True}, min_size=1, max_size=5, open=True)
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_pool() -> ConnectionPool:
    if _pool is None:
        raise RuntimeError("cos API connection pool is not initialized")
    return _pool


def today_chicago(conn) -> date:
    with conn.cursor() as cur:
        cur.execute("SELECT cos.today_chicago()")
        return cur.fetchone()[0]


def list_pending(conn, owner: Optional[str]) -> list[dict[str, Any]]:
    sql = f"""
        SELECT *, row_number() OVER (ORDER BY {_SURFACED_ORDER_SQL}) AS digest_position
        FROM cos.v_surfaced
        WHERE (%(owner)s::text IS NULL OR owner = %(owner)s)
        ORDER BY {_SURFACED_ORDER_SQL}
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, {"owner": owner})
        return cur.fetchall()


def get_decision(conn, decision_id: UUID) -> Optional[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM cos.pending_decisions WHERE id = %s", (decision_id,))
        return cur.fetchone()


def create_decision(conn, body) -> dict[str, Any]:
    urgency = body.urgency or "normal"
    lead_days = body.lead_days if body.lead_days is not None else 7
    owner = body.owner or "egan"
    source_ref = str(uuid4())
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            INSERT INTO cos.pending_decisions
                (title, deadline, urgency, lead_days, consequence, detail, owner, source, source_ref)
            VALUES
                (%(title)s, %(deadline)s, %(urgency)s, %(lead_days)s, %(consequence)s,
                 %(detail)s, %(owner)s, 'manual', %(source_ref)s)
            RETURNING *
            """,
            {
                "title": body.title,
                "deadline": body.deadline,
                "urgency": urgency,
                "lead_days": lead_days,
                "consequence": body.consequence,
                "detail": body.detail,
                "owner": owner,
                "source_ref": source_ref,
            },
        )
        return cur.fetchone()


def transition_status(conn, decision_id: UUID, new_status: str):
    """Move a decision to done/dismissed.

    Returns (row, err) where err is:
      - None on success (row is the updated row)
      - "not_found" if no such id (row is None)
      - ("conflict", current_status) if status != 'open' (row is the current row)
    """
    row = get_decision(conn, decision_id)
    if row is None:
        return None, "not_found"
    if row["status"] != "open":
        return row, ("conflict", row["status"])
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            UPDATE cos.pending_decisions
            SET status = %s, resolved_at = now(), updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (new_status, decision_id),
        )
        return cur.fetchone(), None


def snooze_decision(conn, decision_id: UUID, until: date):
    """Returns (row, err) using the same err vocabulary as transition_status,
    plus "past_date" when until < cos.today_chicago()."""
    row = get_decision(conn, decision_id)
    if row is None:
        return None, "not_found"
    if row["status"] != "open":
        return row, ("conflict", row["status"])
    today = today_chicago(conn)
    if until < today:
        return row, "past_date"
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            UPDATE cos.pending_decisions
            SET snoozed_until = %s, updated_at = now()
            WHERE id = %s
            RETURNING *
            """,
            (until, decision_id),
        )
        return cur.fetchone(), None


def get_latest_digest_today(conn) -> Optional[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT * FROM cos.digest_log
            WHERE digest_date = cos.today_chicago()
            ORDER BY sent_at DESC
            LIMIT 1
            """
        )
        return cur.fetchone()


def log_command(
    conn,
    *,
    decision_id: Optional[UUID],
    method: str,
    path: str,
    body: Optional[dict[str, Any]],
    applied: bool,
    error: Optional[str] = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cos.command_log (decision_id, source_agent, parsed_action, applied, error)
            VALUES (%s, 'hermes', %s, %s, %s)
            """,
            (
                decision_id,
                Json({"method": method, "path": path, "body": body}),
                applied,
                error,
            ),
        )
