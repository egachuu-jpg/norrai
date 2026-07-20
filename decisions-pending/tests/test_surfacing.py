"""Test cos.v_surfaced view logic.

The view surfaces items that are:
  - status = 'open'
  - not snoozed into the future
  - within the lead window (deadline - lead_days <= today)
"""

import uuid
import pytest
import psycopg


def test_snoozed_until_tomorrow_hidden(db):
    """Item snoozed until tomorrow must be hidden from v_surfaced."""
    today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
    tomorrow = (today + __import__("datetime").timedelta(days=1))

    item_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.pending_decisions
        (id, title, status, snoozed_until, source, source_ref)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (item_id, "Test item", "open", tomorrow, "manual", str(uuid.uuid4())),
    )

    result = db.execute(
        "SELECT id FROM cos.v_surfaced WHERE id = %s", (item_id,)
    ).fetchone()
    assert result is None, "Snoozed-until-tomorrow item should not appear in v_surfaced"


def test_snoozed_until_today_shown(db):
    """Item snoozed until today must be shown in v_surfaced."""
    today = db.execute("SELECT cos.today_chicago()").fetchone()[0]

    item_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.pending_decisions
        (id, title, status, snoozed_until, source, source_ref)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (item_id, "Test item", "open", today, "manual", str(uuid.uuid4())),
    )

    result = db.execute(
        "SELECT id FROM cos.v_surfaced WHERE id = %s", (item_id,)
    ).fetchone()
    assert result is not None, "Snoozed-until-today item should appear in v_surfaced"


def test_deadline_outside_lead_window_hidden(db):
    """Item with deadline - lead_days > today must be hidden."""
    today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
    # deadline - lead_days > today  =>  deadline > today + lead_days
    deadline = today + __import__("datetime").timedelta(days=15)
    lead_days = 7

    item_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.pending_decisions
        (id, title, status, deadline, lead_days, source, source_ref)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (item_id, "Test item", "open", deadline, lead_days, "manual", str(uuid.uuid4())),
    )

    result = db.execute(
        "SELECT id FROM cos.v_surfaced WHERE id = %s", (item_id,)
    ).fetchone()
    assert result is None, "Item outside lead window should not appear in v_surfaced"


def test_no_deadline_always_shown(db):
    """Item with no deadline must always be shown in v_surfaced."""
    item_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.pending_decisions
        (id, title, status, deadline, source, source_ref)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (item_id, "Test item", "open", None, "manual", str(uuid.uuid4())),
    )

    result = db.execute(
        "SELECT id FROM cos.v_surfaced WHERE id = %s", (item_id,)
    ).fetchone()
    assert result is not None, "No-deadline open item should always appear in v_surfaced"


@pytest.mark.parametrize("status", ["done", "dismissed", "expired"])
def test_non_open_status_never_shown(db, status):
    """Item with non-open status must never appear, even with today deadline."""
    today = db.execute("SELECT cos.today_chicago()").fetchone()[0]

    item_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.pending_decisions
        (id, title, status, deadline, lead_days, source, source_ref)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (item_id, "Test item", status, today, 7, "manual", str(uuid.uuid4())),
    )

    result = db.execute(
        "SELECT id FROM cos.v_surfaced WHERE id = %s", (item_id,)
    ).fetchone()
    assert (
        result is None
    ), f"Item with status={status} should never appear in v_surfaced"


def test_boundary_deadline_minus_lead_days_equals_today_shown(db):
    """Item where deadline - lead_days = today must be shown (boundary test)."""
    today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
    lead_days = 7
    # deadline - lead_days = today  =>  deadline = today + lead_days
    deadline = today + __import__("datetime").timedelta(days=lead_days)

    item_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.pending_decisions
        (id, title, status, deadline, lead_days, source, source_ref)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (item_id, "Test item", "open", deadline, lead_days, "manual", str(uuid.uuid4())),
    )

    result = db.execute(
        "SELECT id FROM cos.v_surfaced WHERE id = %s", (item_id,)
    ).fetchone()
    assert (
        result is not None
    ), "Item at the lead window boundary (deadline - lead_days = today) must be shown"
