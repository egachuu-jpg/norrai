#!/usr/bin/env python3
"""Apply realistic demo/seed data to the Decisions Pending database.

Reads COS_DB_URL from environment (fallback: COS_TEST_DB_URL).
Runs sql/002_seed.sql via psql.
Prints row counts per table after seeding.

Usage:
    COS_DB_URL=postgresql://postgres@localhost:5439/cos_test python3 scripts/seed_demo.py

Or for testing:
    COS_TEST_DB_URL=postgresql://postgres@localhost:5439/cos_test_a3 python3 scripts/seed_demo.py
"""

import os
import pathlib
import subprocess
import sys

import psycopg

ROOT = pathlib.Path(__file__).parent.parent

DB_URL = os.environ.get(
    "COS_DB_URL",
    os.environ.get("COS_TEST_DB_URL", "postgresql://postgres@localhost:5439/cos_test"),
)


def apply_sql_file(path: pathlib.Path) -> None:
    """Run a .sql file via psql."""
    result = subprocess.run(
        ["psql", DB_URL, "-q", "-v", "ON_ERROR_STOP=1", "-f", str(path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql -f {path.name} failed:\n{result.stderr}")


def print_row_counts() -> None:
    """Connect and print row counts for cos tables."""
    try:
        with psycopg.connect(DB_URL) as conn:
            cursor = conn.cursor()
            tables = [
                "cos.pending_decisions",
                "cos.decision_rules",
                "cos.digest_log",
                "cos.command_log",
            ]
            print("\nRow counts after seeding:")
            for table in tables:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                count = cursor.fetchone()[0]
                print(f"  {table}: {count} rows")
    except Exception as e:
        print(f"Warning: could not fetch row counts: {e}", file=sys.stderr)


def main() -> None:
    """Apply seed data and report results."""
    print(f"Seeding database: {DB_URL}")
    seed_file = ROOT / "sql" / "002_seed.sql"

    if not seed_file.exists():
        print(f"Error: {seed_file} not found", file=sys.stderr)
        sys.exit(1)

    try:
        apply_sql_file(seed_file)
        print(f"✓ Applied {seed_file.name}")
        print_row_counts()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
