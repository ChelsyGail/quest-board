from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class QueueEntryAttributes(BaseModel):
    """One attempt waiting for a moderator, with enough to triage it."""

    participation_id: str
    item_id: str
    item_title: str
    user_id: str
    student_name: str
    attempt_number: int
    has_text: bool
    media_count: int
    submitted_at: datetime


class QueueEntryResourceData(BaseModel):
    type: Literal["pending-submissions"] = "pending-submissions"
    id: str
    attributes: QueueEntryAttributes
