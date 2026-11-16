from __future__ import annotations

from datetime import datetime
from typing import Annotated
from typing import Literal

from models.catalogue import ItemResourceData
from models.proof import SubmissionMedia
from models.proof import SubmissionStatus
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import StringConstraints


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


class StudentSummary(BaseModel):
    user_id: str
    name: str


class SubmissionDetailAttributes(BaseModel):
    """Everything a moderator needs to judge one attempt (BE-45)."""

    participation_id: str
    attempt_number: int
    status: SubmissionStatus
    text: str | None
    # Each url streams through GET /media/{id}, which only owners and moderators
    # can read (BE-42).
    media: list[SubmissionMedia]
    # The twist the student was given when joining. Twists (BE-26/BE-29) are not
    # built yet, so this is always null for now.
    twist: str | None = None
    submitted_at: datetime
    student: StudentSummary
    quest: ItemResourceData


class SubmissionDetailResourceData(BaseModel):
    type: Literal["submission-details"] = "submission-details"
    id: str
    attributes: SubmissionDetailAttributes


class ReviewAttributes(BaseModel):
    submission_id: str
    participation_id: str
    reviewer_id: str
    decision: SubmissionStatus
    feedback: str | None
    reviewed_at: datetime
    # Points the student earned with this decision; null for a rejection.
    points_awarded: int | None = None


class ReviewResourceData(BaseModel):
    type: Literal["reviews"] = "reviews"
    id: str
    attributes: ReviewAttributes


Feedback = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]


class RejectionCreate(BaseModel):
    """A rejection has to tell the student what to fix (BE-47)."""

    model_config = ConfigDict(extra="forbid")

    feedback: Feedback
