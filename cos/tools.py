import base64
import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

RANK = {"red": 2, "yellow": 1, "green": 0}
SCHEDULED_WORKFLOWS = ["chief_of_staff"]


def _conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def check_client_health() -> dict:
    """
    Query Neon for active client health. Mirrors the logic in the
    'Apply Health Logic' node of the Norr AI Client Health Query workflow.
    Red = failures in last 7 days. Yellow = silence (no triggers in 7 days).
    Green = healthy.
    """
    with _conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    c.id,
                    c.business_name,
                    c.vertical,
                    c.tier,
                    we.workflow_name,
                    MAX(CASE WHEN we.event_type = 'triggered' THEN we.created_at END) AS last_triggered_at,
                    MAX(CASE WHEN we.event_type = 'failed'    THEN we.created_at END) AS last_failed_at,
                    COUNT(CASE WHEN we.event_type = 'failed'
                               AND we.created_at > now() - interval '7 days' THEN 1 END) AS failures_7d
                FROM clients c
                LEFT JOIN workflow_events we ON we.client_id = c.id
                WHERE c.status = 'active'
                GROUP BY c.id, c.business_name, c.vertical, c.tier, we.workflow_name
                ORDER BY c.business_name, we.workflow_name
            """)
            rows = cur.fetchall()

    now = datetime.now(timezone.utc)
    client_map: dict = {}

    for row in rows:
        key = str(row["id"])
        if key not in client_map:
            client_map[key] = {
                "business_name": row["business_name"],
                "vertical": row["vertical"],
                "tier": row["tier"],
                "workflows": [],
            }
        if not row["workflow_name"]:
            continue

        is_scheduled = any(s in row["workflow_name"] for s in SCHEDULED_WORKFLOWS)
        threshold = now - timedelta(days=2 if is_scheduled else 7)
        last_triggered = row["last_triggered_at"]
        failures = int(row["failures_7d"] or 0)

        if failures > 0:
            status = "red"
        elif not last_triggered or last_triggered.replace(tzinfo=timezone.utc) < threshold:
            status = "yellow"
        else:
            status = "green"

        client_map[key]["workflows"].append({
            "workflow_name": row["workflow_name"],
            "status": status,
            "last_triggered_at": row["last_triggered_at"].isoformat() if row["last_triggered_at"] else None,
            "last_failed_at": row["last_failed_at"].isoformat() if row["last_failed_at"] else None,
            "failures_7d": failures,
        })

    clients = []
    for c in client_map.values():
        worst = max((wf["status"] for wf in c["workflows"]), key=lambda s: RANK[s], default="green")
        clients.append({**c, "overall_status": worst})

    clients.sort(key=lambda c: (-RANK[c["overall_status"]], c["business_name"]))
    return {"clients": clients}


def get_open_tasks(section: str | None = None) -> dict:
    """
    Fetch CLAUDE.md from GitHub and return unchecked tasks grouped by subsection.
    Optionally filter to a single section by partial name match (case-insensitive).
    Returns: { sections: { "Immediate": [...], ... }, total_count: N }
    Requires GITHUB_PAT env var with Contents: Read-only on egachuu-jpg/norrai.
    """
    pat = os.environ.get("GITHUB_PAT", "")
    url = "https://api.github.com/repos/egachuu-jpg/norrai/contents/CLAUDE.md"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"token {pat}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "norrai-cos",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())

    raw = base64.b64decode(data["content"]).decode("utf-8")

    # Extract ## Open Tasks section only
    import re
    match = re.search(r"## Open Tasks([\s\S]*?)(?=\n## |\n---\n|\n# |$)", raw)
    if not match:
        return {"sections": {}, "total_count": 0}

    sections: dict[str, list[str]] = {}
    current = "General"
    for line in match.group(1).split("\n"):
        stripped = line.strip()
        if stripped.startswith("### "):
            current = stripped[4:]
        elif stripped.startswith("- [ ]"):
            task = stripped[6:]  # drop "- [ ] "
            sections.setdefault(current, []).append(task)

    if section:
        key = section.lower()
        sections = {k: v for k, v in sections.items() if key in k.lower()}

    total = sum(len(v) for v in sections.values())
    return {"sections": sections, "total_count": total}


def get_workflow_errors(days: int = 7, client_name: str | None = None) -> dict:
    """
    Return workflow failure events from the last N days.
    Optionally filter to a specific client by partial name match.
    """
    with _conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if client_name:
                cur.execute("""
                    SELECT
                        c.business_name,
                        we.workflow_name,
                        we.payload,
                        we.created_at
                    FROM workflow_events we
                    JOIN clients c ON c.id = we.client_id
                    WHERE we.event_type = 'failed'
                      AND we.created_at > now() - interval '1 day' * %s
                      AND c.business_name ILIKE %s
                    ORDER BY we.created_at DESC
                    LIMIT 20
                """, (days, f"%{client_name}%"))
            else:
                cur.execute("""
                    SELECT
                        c.business_name,
                        we.workflow_name,
                        we.payload,
                        we.created_at
                    FROM workflow_events we
                    JOIN clients c ON c.id = we.client_id
                    WHERE we.event_type = 'failed'
                      AND we.created_at > now() - interval '1 day' * %s
                    ORDER BY we.created_at DESC
                    LIMIT 20
                """, (days,))
            rows = cur.fetchall()

    errors = [
        {
            "business_name": r["business_name"],
            "workflow_name": r["workflow_name"],
            "failed_at": r["created_at"].isoformat(),
            "payload": r["payload"],
        }
        for r in rows
    ]
    return {"errors": errors, "count": len(errors), "days": days}
