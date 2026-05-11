import json
import os

import psycopg2
from psycopg2.extras import RealDictCursor


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def load_session(user_id: str, channel: str) -> list:
    with _conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT messages FROM cos_sessions WHERE user_id = %s AND channel = %s",
                (user_id, channel),
            )
            row = cur.fetchone()
            return row["messages"] if row else []


def save_session(user_id: str, channel: str, messages: list) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO cos_sessions (user_id, channel, messages)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, channel)
                DO UPDATE SET messages = EXCLUDED.messages, updated_at = now()
                """,
                (user_id, channel, json.dumps(messages)),
            )
        conn.commit()
