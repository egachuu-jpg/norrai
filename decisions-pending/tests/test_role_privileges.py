"""Test cos_api role privilege restrictions.

The cos_api role should:
  - Have SELECT, INSERT, UPDATE on cos.pending_decisions and cos.command_log
  - Have SELECT on cos.v_surfaced and cos.digest_log
  - NOT have DELETE anywhere
  - NOT have access to public schema
  - NOT have any access to cos.decision_rules
  - NOT be able to INSERT into cos.digest_log (read-only)
"""

import uuid
import pytest
import psycopg
from psycopg import errors


def test_cos_api_cannot_access_public_schema(db):
    """cos_api role cannot SELECT from public schema tables."""
    # Create a test table in public schema (as superuser)
    db.execute("CREATE TABLE IF NOT EXISTS public.priv_probe(x int)")
    db.execute("INSERT INTO public.priv_probe(x) VALUES (1)")

    try:
        # Set role to cos_api in a fresh cursor
        cursor = db.cursor()
        cursor.execute("SET ROLE cos_api")

        # Attempt to SELECT from public.priv_probe should fail
        with pytest.raises(errors.InsufficientPrivilege):
            cursor.execute("SELECT * FROM public.priv_probe")

        cursor.execute("RESET ROLE")
        cursor.close()
    finally:
        # Clean up
        db.execute("DROP TABLE IF EXISTS public.priv_probe")


def test_cos_api_cannot_delete_from_pending_decisions(db):
    """cos_api role cannot DELETE from cos.pending_decisions."""
    # Insert a test row as superuser
    item_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.pending_decisions
        (id, title, status, source, source_ref)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (item_id, "Test item", "open", "manual", str(uuid.uuid4())),
    )

    try:
        cursor = db.cursor()
        cursor.execute("SET ROLE cos_api")

        # Attempt DELETE should fail
        with pytest.raises(errors.InsufficientPrivilege):
            cursor.execute(
                "DELETE FROM cos.pending_decisions WHERE id = %s", (item_id,)
            )

        cursor.execute("RESET ROLE")
        cursor.close()
    except Exception as e:
        # Ensure we reset the role even if something unexpected happens
        try:
            cursor.execute("RESET ROLE")
        except Exception:
            pass
        raise


def test_cos_api_can_select_insert_update_pending_decisions(db):
    """cos_api role can SELECT, INSERT, and UPDATE on cos.pending_decisions."""
    cursor = db.cursor()
    try:
        cursor.execute("SET ROLE cos_api")

        # Test INSERT
        item_id = uuid.uuid4()
        source_ref = str(uuid.uuid4())
        cursor.execute(
            """
            INSERT INTO cos.pending_decisions
            (id, title, status, source, source_ref)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (item_id, "Test item", "open", "manual", source_ref),
        )

        # Test SELECT
        cursor.execute(
            "SELECT id, title FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        )
        result = cursor.fetchone()
        assert result is not None
        assert result[0] == item_id
        assert result[1] == "Test item"

        # Test UPDATE
        cursor.execute(
            "UPDATE cos.pending_decisions SET title = %s WHERE id = %s",
            ("Updated title", item_id),
        )

        cursor.execute(
            "SELECT title FROM cos.pending_decisions WHERE id = %s",
            (item_id,),
        )
        result = cursor.fetchone()
        assert result[0] == "Updated title"

        cursor.execute("RESET ROLE")
    finally:
        cursor.close()


def test_cos_api_can_select_v_surfaced(db):
    """cos_api role can SELECT from cos.v_surfaced view."""
    # Insert a test row as superuser
    item_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.pending_decisions
        (id, title, status, source, source_ref)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (item_id, "Test item", "open", "manual", str(uuid.uuid4())),
    )

    cursor = db.cursor()
    try:
        cursor.execute("SET ROLE cos_api")

        cursor.execute("SELECT id FROM cos.v_surfaced WHERE id = %s", (item_id,))
        result = cursor.fetchone()
        assert result is not None
        assert result[0] == item_id

        cursor.execute("RESET ROLE")
    finally:
        cursor.close()


def test_cos_api_can_select_digest_log(db):
    """cos_api role can SELECT from cos.digest_log."""
    # Insert a test row as superuser
    digest_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.digest_log
        (id, digest_date, rendered_text, item_ids, model)
        VALUES (%s, cos.today_chicago(), %s, %s, %s)
        """,
        (digest_id, "Test digest", [uuid.uuid4()], "test-model"),
    )

    cursor = db.cursor()
    try:
        cursor.execute("SET ROLE cos_api")

        cursor.execute("SELECT id FROM cos.digest_log WHERE id = %s", (digest_id,))
        result = cursor.fetchone()
        assert result is not None
        assert result[0] == digest_id

        cursor.execute("RESET ROLE")
    finally:
        cursor.close()


def test_cos_api_cannot_insert_digest_log(db):
    """cos_api role cannot INSERT into cos.digest_log (read-only)."""
    cursor = db.cursor()
    try:
        cursor.execute("SET ROLE cos_api")

        # Attempt INSERT should fail
        with pytest.raises(errors.InsufficientPrivilege):
            cursor.execute(
                """
                INSERT INTO cos.digest_log
                (id, digest_date, rendered_text, item_ids, model)
                VALUES (%s, cos.today_chicago(), %s, %s, %s)
                """,
                (uuid.uuid4(), "Test digest", [uuid.uuid4()], "test-model"),
            )

        cursor.execute("RESET ROLE")
    finally:
        cursor.close()


def test_cos_api_cannot_access_decision_rules(db):
    """cos_api role has no access to cos.decision_rules table."""
    # Insert a test row as superuser
    rule_id = uuid.uuid4()
    db.execute(
        """
        INSERT INTO cos.decision_rules
        (id, title, rrule, lead_days, urgency)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (rule_id, "Test rule", "FREQ=MONTHLY;BYMONTHDAY=1", 7, "normal"),
    )

    cursor = db.cursor()
    try:
        cursor.execute("SET ROLE cos_api")

        # Attempt SELECT should fail
        with pytest.raises(errors.InsufficientPrivilege):
            cursor.execute("SELECT id FROM cos.decision_rules WHERE id = %s", (rule_id,))

        cursor.execute("RESET ROLE")
    finally:
        cursor.close()

    cursor = db.cursor()
    try:
        cursor.execute("SET ROLE cos_api")

        # Attempt INSERT should fail
        with pytest.raises(errors.InsufficientPrivilege):
            cursor.execute(
                """
                INSERT INTO cos.decision_rules
                (id, title, rrule, lead_days, urgency)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (uuid.uuid4(), "Another rule", "FREQ=WEEKLY", 7, "normal"),
            )

        cursor.execute("RESET ROLE")
    finally:
        cursor.close()


def test_cos_api_can_execute_today_chicago(db):
    """cos_api role can execute cos.today_chicago() function."""
    cursor = db.cursor()
    try:
        cursor.execute("SET ROLE cos_api")

        cursor.execute("SELECT cos.today_chicago()")
        result = cursor.fetchone()
        assert result is not None
        assert result[0] is not None

        cursor.execute("RESET ROLE")
    finally:
        cursor.close()
