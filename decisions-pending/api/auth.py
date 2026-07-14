"""Bearer token auth dependency.

Every endpoint except GET /health requires:
    Authorization: Bearer $COS_API_TOKEN
Anything else -> 401.

Reads COS_API_TOKEN from the environment on every call (not at import time)
so it reflects whatever the process/tests currently have set.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException, status


def require_bearer_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("COS_API_TOKEN")
    if not expected or not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    provided = authorization[len("Bearer "):]
    if not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
