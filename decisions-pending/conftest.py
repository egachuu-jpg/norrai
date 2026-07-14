"""Shared pytest fixtures for the Decisions Pending suite.

Point COS_TEST_DB_URL at a *disposable* Postgres superuser DSN
(docker compose up -d gives you postgresql://postgres:postgres@localhost:5439/cos_test).
The schema is applied once per session; every test starts from truncated tables.
"""

import os
import pathlib
import subprocess

import psycopg
import pytest

ROOT = pathlib.Path(__file__).parent
DB_URL = os.environ.get(
    "COS_TEST_DB_URL", "postgresql://postgres:postgres@localhost:5439/cos_test"
)

# The API under test reads these; set before any api.* import happens.
os.environ.setdefault("COS_DB_URL", DB_URL)
os.environ.setdefault("COS_API_TOKEN", "test-token")


def apply_sql_file(path: pathlib.Path, db_url: str = DB_URL) -> None:
    """Run a .sql file via psql (files use $$ blocks; psql handles them natively)."""
    result = subprocess.run(
        ["psql", db_url, "-q", "-v", "ON_ERROR_STOP=1", "-f", str(path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql -f {path.name} failed:\n{result.stderr}")


@pytest.fixture(scope="session")
def schema() -> str:
    apply_sql_file(ROOT / "sql" / "001_schema.sql")
    return DB_URL


@pytest.fixture()
def db(schema):
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        conn.execute(
            "TRUNCATE cos.pending_decisions, cos.command_log,"
            " cos.digest_log, cos.decision_rules CASCADE"
        )
        yield conn
