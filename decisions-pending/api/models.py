"""Pydantic v2 request/response schemas for the cos API."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel

Urgency = Literal["low", "normal", "high", "critical"]
Status = Literal["open", "done", "dismissed", "expired"]


class DecisionCreate(BaseModel):
    title: str
    deadline: Optional[date] = None
    urgency: Optional[Urgency] = None
    lead_days: Optional[int] = None
    consequence: Optional[str] = None
    detail: Optional[str] = None
    owner: Optional[str] = None


class SnoozeBody(BaseModel):
    until: date


class DecisionOut(BaseModel):
    id: UUID
    title: str
    ask: Optional[str] = None
    detail: Optional[str] = None
    consequence: Optional[str] = None
    deadline: Optional[date] = None
    lead_days: int
    urgency: Urgency
    status: Status
    snoozed_until: Optional[date] = None
    owner: str
    source: str
    source_ref: str
    draft_reply: Optional[str] = None
    nag_pending: bool
    escalated_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime] = None


class PendingItem(DecisionOut):
    digest_position: int


class DraftOut(BaseModel):
    draft_reply: str


class DigestOut(BaseModel):
    rendered_text: str
    sent_at: datetime
