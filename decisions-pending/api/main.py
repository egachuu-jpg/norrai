"""FastAPI app assembly for the cos API.

The DB pool is created in the lifespan handler (app startup), not at import
time, so it picks up COS_DB_URL from whatever environment is active when the
app actually starts -- this is what lets tests point it at a fresh test DB.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db
from .routes import health_router, router


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_pool()
    try:
        yield
    finally:
        db.close_pool()


app = FastAPI(title="cos API", lifespan=lifespan)
app.include_router(health_router)
app.include_router(router)
