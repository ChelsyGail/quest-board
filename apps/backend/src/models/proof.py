from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import field_validator
from pydantic import PositiveInt
from pydantic import StringConstraints
from utilities.media_types import MediaKind

ProofText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)
]

# Files per attempt. The C4 document leaves the number open; five photos or
# clips is plenty to prove one quest.
MAX_MEDIA_PER_SUBMISSION = 5


class SubmissionStatus(StrEnum):
    """Where one attempt stands. Derived, never stored: an attempt is Pending
    until it has a review, then it takes the review's decision."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class SubmissionCreate(BaseModel):
    """Text, uploaded media, or both. Media are uploaded first through
    POST /uploads and referenced here by id."""

    model_config = ConfigDict(extra="forbid")

    text: ProofText | None = None
    media_ids: list[PositiveInt] = Field(
        default_factory=list, max_length=MAX_MEDIA_PER_SUBMISSION
    )

    @field_validator("media_ids")
    @classmethod
    def reject_repeats(cls, media_ids: list[int]) -> list[int]:
        if len(set(media_ids)) != len(media_ids):
            raise ValueError("Each upload can only be attached once")
        return media_ids


class MediaAttributes(BaseModel):
    content_type: str
    kind: MediaKind
    size_bytes: int
    uploaded_at: datetime


class MediaResourceData(BaseModel):
    type: Literal["media"] = "media"
    id: str
    attributes: MediaAttributes


class SubmissionMedia(BaseModel):
    """A file attached to an attempt, as the attempt lists it."""

    id: str
    content_type: str
    kind: MediaKind
    size_bytes: int


class SubmissionAttributes(BaseModel):
    participation_id: str
    item_id: str
    user_id: str
    attempt_number: int
    text: str | None
    media: list[SubmissionMedia]
    status: SubmissionStatus
    submitted_at: datetime


class SubmissionResourceData(BaseModel):
    type: Literal["submissions"] = "submissions"
    id: str
    attributes: SubmissionAttributes
