import json
import os

import anthropic

from tools import check_client_health, get_open_tasks, get_workflow_errors

_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

MODEL = "claude-sonnet-4-6"
MAX_HISTORY = 20  # messages retained per session (controls token cost)

SYSTEM_PROMPT = """You are the Norr AI Chief of Staff — an internal assistant for Egan, who runs Norr AI, an AI automation agency in Faribault, Minnesota.

Your job: help Egan monitor and manage the Norr AI business. You have three tools:
- check_client_health: overall red/yellow/green status per active client and workflow
- get_workflow_errors: recent failure events from Neon, optionally filtered by client or time window
- get_open_tasks: open (unchecked) tasks from CLAUDE.md, grouped by section — use this when Egan asks what's on his plate, what to work on, or what's pending

Be concise and direct. Egan is a technical data engineer — no fluff. Plain text only (works in both Slack and SMS).

Health status legend:
🔴 Red = workflow failures in the last 7 days — needs attention
🟡 Yellow = no workflow activity in 7 days — possible silence or setup gap
🟢 Green = healthy"""

TOOLS = [
    {
        "name": "check_client_health",
        "description": (
            "Check the health of all active Norr AI clients. Returns red/yellow/green "
            "status per client and workflow based on recent workflow_events in Neon. "
            "Red = failures in last 7 days. Yellow = silence (no triggers). Green = healthy."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_open_tasks",
        "description": (
            "Fetch open (unchecked) tasks from CLAUDE.md in the norrai GitHub repo. "
            "Returns tasks grouped by subsection (Immediate, Security, Near Term, etc.). "
            "Optionally filter to a specific section by partial name."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "section": {
                    "type": "string",
                    "description": "Partial section name to filter (e.g. 'immediate', 'near term'). Omit for all sections.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_workflow_errors",
        "description": (
            "Get workflow failure events from Neon. "
            "Optionally filter by days back (default 7) or client name (partial match)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "How many days back to look (default 7)",
                },
                "client_name": {
                    "type": "string",
                    "description": "Partial client name to filter results",
                },
            },
            "required": [],
        },
    },
]


def _execute_tool(name: str, inputs: dict):
    if name == "check_client_health":
        return check_client_health()
    if name == "get_open_tasks":
        return get_open_tasks(section=inputs.get("section"))
    if name == "get_workflow_errors":
        return get_workflow_errors(
            days=inputs.get("days", 7),
            client_name=inputs.get("client_name"),
        )
    return {"error": f"Unknown tool: {name}"}


def run_turn(history: list, user_message: str) -> tuple[str, list]:
    """
    Run one conversational turn. Returns (reply_text, updated_history).
    history is the Claude messages array (role/content pairs).
    Caps history at MAX_HISTORY messages before the new turn.
    """
    if len(history) > MAX_HISTORY:
        history = history[-MAX_HISTORY:]

    messages = history + [{"role": "user", "content": user_message}]

    while True:
        response = _client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        messages = messages + [{"role": "assistant", "content": response.content}]

        if response.stop_reason == "end_turn":
            text = next(
                (b.text for b in response.content if hasattr(b, "text")), ""
            )
            return text, messages

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result = _execute_tool(block.name, block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result),
                    })
            messages = messages + [{"role": "user", "content": tool_results}]
