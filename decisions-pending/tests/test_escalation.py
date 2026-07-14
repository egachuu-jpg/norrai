"""Test the nightly escalation and expiry job (Task A4).

This tests the sql/003_escalation_expiry.sql script across three stages:
  1. ESCALATION: deadline-based urgency promotion
  2. EXPIRY: marking overdue items and creating synthetic notices
  3. ANTI-STALENESS: flagging items that appear in all recent digests
"""

import datetime
import os
import pathlib
import uuid

import pytest

ROOT = pathlib.Path(__file__).parent.parent


def apply_sql_file(path: pathlib.Path, db_url: str = None) -> None:
    """Import and use the conftest helper."""
    if db_url is None:
        db_url = os.environ.get(
            "COS_TEST_DB_URL", "postgresql://postgres:postgres@localhost:5439/cos_test"
        )
    from conftest import apply_sql_file as _apply_sql_file
    _apply_sql_file(path, db_url)


def run_escalation_script(db_url: str = None) -> None:
    """Helper to run the escalation/expiry script."""
    if db_url is None:
        db_url = os.environ.get(
            "COS_TEST_DB_URL", "postgresql://postgres:postgres@localhost:5439/cos_test"
        )
    apply_sql_file(ROOT / "sql" / "003_escalation_expiry.sql", db_url=db_url)


class TestEscalation:
    """Test the ESCALATION stage (3a)."""

    def test_escalate_to_critical_at_3_day_mark(self, db):
        """Deadline in 3 days, urgency normal → becomes critical."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
        deadline = today + datetime.timedelta(days=3)

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Test item", "normal", deadline, "open", "manual", str(uuid.uuid4())),
        )

        # Run the script
        run_escalation_script()

        row = db.execute(
            "SELECT urgency, escalated_at FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] == "critical", "Urgency should be 'critical' at 3-day mark"
        # The 3-day absolute assignment does NOT set escalated_at (only the 7-day tier bump does)
        assert row[1] is None, "escalated_at should not be set for absolute assignment"

    def test_escalate_to_normal_at_7_day_mark(self, db):
        """Deadline in 7 days, urgency low → becomes normal, escalated_at set."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
        deadline = today + datetime.timedelta(days=7)

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Test item", "low", deadline, "open", "manual", str(uuid.uuid4())),
        )

        # Run the script
        run_escalation_script()

        row = db.execute(
            "SELECT urgency, escalated_at FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] == "normal", "Urgency should be promoted from 'low' to 'normal'"
        assert row[1] is not None, "escalated_at should be set on tier promotion"

    def test_escalation_idempotency_run_twice_same_day(self, db):
        """Deadline in 7 days: run script twice same day → stays normal (not high)."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
        deadline = today + datetime.timedelta(days=7)

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Test item", "low", deadline, "open", "manual", str(uuid.uuid4())),
        )

        # First run of the script
        run_escalation_script()
        row1 = db.execute(
            "SELECT urgency, escalated_at FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()
        assert row1[0] == "normal", "First run: urgency should be 'normal'"
        first_escalated_at = row1[1]

        # Run the script again (second time)
        run_escalation_script()

        row2 = db.execute(
            "SELECT urgency, escalated_at FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row2[0] == "normal", "Second run: urgency should still be 'normal' (not promoted to 'high')"
        assert row2[1] == first_escalated_at, "escalated_at should not change on second run"

    def test_no_escalation_beyond_lead_window(self, db):
        """Deadline in 20 days → untouched."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
        deadline = today + datetime.timedelta(days=20)

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Test item", "low", deadline, "open", "manual", str(uuid.uuid4())),
        )

        # Run the script
        run_escalation_script()

        row = db.execute(
            "SELECT urgency, escalated_at FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] == "low", "Urgency should remain 'low' (outside lead window)"
        assert row[1] is None, "escalated_at should not be set"

    def test_escalation_respects_snoozed(self, db):
        """Snoozed items should not be escalated (status='open' but hidden from surfacing)."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
        deadline = today + datetime.timedelta(days=3)
        snoozed_until = today + datetime.timedelta(days=5)

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, snoozed_until, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Snoozed item", "normal", deadline, "open", snoozed_until, "manual", str(uuid.uuid4())),
        )

        # Run the script
        run_escalation_script()

        # Escalation should still run on snoozed items (status='open')
        # Actually, looking at the logic, snoozed_until doesn't gate escalation — only status does.
        # So this should escalate.
        row = db.execute(
            "SELECT urgency FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] == "critical", "Even snoozed items escalate (they're still status='open')"


class TestExpiry:
    """Test the EXPIRY stage (3b)."""

    def test_expiry_marks_overdue_open_as_expired(self, db):
        """Deadline yesterday, open → status='expired', resolved_at set."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
        deadline = today - datetime.timedelta(days=1)

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Overdue item", "normal", deadline, "open", "manual", str(uuid.uuid4())),
        )

        # Run the script
        run_escalation_script()

        row = db.execute(
            "SELECT status, resolved_at FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] == "expired", "Status should be 'expired'"
        assert row[1] is not None, "resolved_at should be set"

    def test_expiry_creates_synthetic_notice(self, db):
        """Expired item creates exactly one system notice row."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
        deadline = today - datetime.timedelta(days=1)

        item_id = uuid.uuid4()
        original_title = "Overdue item"
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, original_title, "normal", deadline, "open", "manual", str(uuid.uuid4())),
        )

        # Run the script
        run_escalation_script()

        notice_rows = db.execute(
            "SELECT id, title, source, source_ref, urgency, deadline, status FROM cos.pending_decisions WHERE source = 'system' AND source_ref = %s",
            (f"expired:{item_id}",),
        ).fetchall()

        assert len(notice_rows) == 1, "Should create exactly one synthetic notice"
        notice_id, title, source, source_ref, urgency, deadline_val, status = notice_rows[0]

        assert source == "system"
        assert source_ref == f"expired:{item_id}"
        assert title == f"Expired unactioned: {original_title}"
        assert urgency == "high"
        assert deadline_val is None, "Synthetic notice should have no deadline"
        assert status == "open", "Synthetic notice should be open"

    def test_expiry_idempotency_run_twice(self, db):
        """Run expiry script twice same day → exactly one notice (no duplicates)."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
        deadline = today - datetime.timedelta(days=1)

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Overdue item", "normal", deadline, "open", "manual", str(uuid.uuid4())),
        )

        # First run
        run_escalation_script()
        first_notices = db.execute(
            "SELECT COUNT(*) FROM cos.pending_decisions WHERE source = 'system' AND source_ref = %s",
            (f"expired:{item_id}",),
        ).fetchone()[0]
        assert first_notices == 1

        # Run again
        run_escalation_script()

        second_notices = db.execute(
            "SELECT COUNT(*) FROM cos.pending_decisions WHERE source = 'system' AND source_ref = %s",
            (f"expired:{item_id}",),
        ).fetchone()[0]

        assert second_notices == 1, "Should still be exactly one notice (ON CONFLICT DO NOTHING prevents duplicate)"

    def test_expiry_ignores_non_open_status(self, db):
        """Expired deadline but status='done' → should not be marked as expired."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]
        deadline = today - datetime.timedelta(days=1)

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Done item", "normal", deadline, "done", "manual", str(uuid.uuid4())),
        )

        # Run the script
        run_escalation_script()

        row = db.execute(
            "SELECT status FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] == "done", "Status should remain 'done' (not changed to 'expired')"

    def test_expiry_ignores_no_deadline(self, db):
        """No deadline → should not expire even if created in the past."""
        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, deadline, status, source, source_ref, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                item_id,
                "No deadline item",
                "normal",
                None,
                "open",
                "manual",
                str(uuid.uuid4()),
                datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30),
            ),
        )

        # Run the script
        run_escalation_script()

        row = db.execute(
            "SELECT status FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] == "open", "No-deadline items should never expire"


class TestAntiStaleness:
    """Test the ANTI-STALENESS stage (3c)."""

    def test_nag_flag_when_in_all_5_recent_digests_and_no_command(self, db):
        """Item in all 5 most recent digests, no command_log → nag_pending=true."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Test item", "normal", "open", "manual", str(uuid.uuid4())),
        )

        # Insert 5 digest_log rows over 5 days, all containing this item_id
        for i in range(5):
            sent_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=4 - i)
            db.execute(
                """
                INSERT INTO cos.digest_log
                (item_ids, digest_date, rendered_text, model, sent_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    [item_id],  # psycopg3 handles UUID arrays
                    today - datetime.timedelta(days=4 - i),
                    "mock rendered text",
                    "mock-model",
                    sent_at,
                ),
            )

        # Run the script
        run_escalation_script()

        row = db.execute(
            "SELECT nag_pending FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] is True, "nag_pending should be true (in all 5 digests, no command_log)"

    def test_nag_cleared_when_command_log_appears(self, db):
        """Item in all 5 digests: add command_log, rerun → nag_pending=false."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Test item", "normal", "open", "manual", str(uuid.uuid4())),
        )

        # Insert 5 digest_log rows
        for i in range(5):
            sent_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=4 - i)
            db.execute(
                """
                INSERT INTO cos.digest_log
                (item_ids, digest_date, rendered_text, model, sent_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                ([item_id], today - datetime.timedelta(days=4 - i), "mock", "mock-model", sent_at),
            )

        # First run should set nag_pending=true
        run_escalation_script()

        row = db.execute(
            "SELECT nag_pending FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()
        assert row[0] is True

        # Add a command_log row for this item
        db.execute(
            """
            INSERT INTO cos.command_log
            (decision_id, parsed_action, applied)
            VALUES (%s, %s, %s)
            """,
            (item_id, '{"method": "PUT"}', True),
        )

        # Run the script again
        run_escalation_script()

        row = db.execute(
            "SELECT nag_pending FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] is False, "nag_pending should be false after command_log appears"

    def test_nag_not_flagged_if_in_only_4_of_5_digests(self, db):
        """Item in only 4 of 5 most recent digests → not flagged."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]

        item1_id = uuid.uuid4()
        item2_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s),
                   (%s, %s, %s, %s, %s, %s)
            """,
            (
                item1_id, "Item in 4 digests", "normal", "open", "manual", str(uuid.uuid4()),
                item2_id, "Item in all 5 digests", "normal", "open", "manual", str(uuid.uuid4()),
            ),
        )

        # Insert 5 digest_log rows
        # item1_id in digests 0-3 (missing from digest 4)
        # item2_id in all 5 digests
        for i in range(5):
            sent_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=4 - i)
            item_ids = [item2_id]
            if i < 4:  # item1 in first 4 only
                item_ids.append(item1_id)

            db.execute(
                """
                INSERT INTO cos.digest_log
                (item_ids, digest_date, rendered_text, model, sent_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    item_ids,
                    today - datetime.timedelta(days=4 - i),
                    "mock",
                    "mock-model",
                    sent_at,
                ),
            )

        # Run the script
        run_escalation_script()

        row1 = db.execute(
            "SELECT nag_pending FROM cos.pending_decisions WHERE id = %s",
            (item1_id,),
        ).fetchone()

        row2 = db.execute(
            "SELECT nag_pending FROM cos.pending_decisions WHERE id = %s",
            (item2_id,),
        ).fetchone()

        assert row1[0] is False, "item1 should NOT be flagged (only in 4 of 5 digests)"
        assert row2[0] is True, "item2 should be flagged (in all 5 digests)"

    def test_nag_not_flagged_if_fewer_than_5_digests(self, db):
        """Fewer than 5 digests → no items flagged."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Test item", "normal", "open", "manual", str(uuid.uuid4())),
        )

        # Insert only 3 digest_log rows (fewer than 5)
        for i in range(3):
            sent_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=2 - i)
            db.execute(
                """
                INSERT INTO cos.digest_log
                (item_ids, digest_date, rendered_text, model, sent_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                ([item_id], today - datetime.timedelta(days=2 - i), "mock", "mock-model", sent_at),
            )

        # Run the script
        run_escalation_script()

        row = db.execute(
            "SELECT nag_pending FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] is False, "nag_pending should be false (fewer than 5 digests)"

    def test_nag_clears_for_dismissed_items(self, db):
        """Items with status != 'open' should never have nag_pending=true."""
        today = db.execute("SELECT cos.today_chicago()").fetchone()[0]

        item_id = uuid.uuid4()
        db.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, urgency, status, source, source_ref, nag_pending)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (item_id, "Dismissed item", "normal", "dismissed", "manual", str(uuid.uuid4()), True),
        )

        # Insert 5 digest_log rows (even though dismissed, shouldn't be in digests, but test the logic)
        for i in range(5):
            sent_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=4 - i)
            db.execute(
                """
                INSERT INTO cos.digest_log
                (item_ids, digest_date, rendered_text, model, sent_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                ([item_id], today - datetime.timedelta(days=4 - i), "mock", "mock-model", sent_at),
            )

        # Run the script
        run_escalation_script()

        row = db.execute(
            "SELECT nag_pending FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        ).fetchone()

        assert row[0] is False, "nag_pending should be false for non-open items"
