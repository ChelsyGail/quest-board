from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from functools import lru_cache
from typing import Annotated
from typing import Literal
from zoneinfo import available_timezones

from pydantic import AwareDatetime
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import field_validator
from pydantic import model_validator
from pydantic import StringConstraints

ItemTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
ItemDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)
]
ItemLocation = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
]
ItemCategory = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]
ProofInstructions = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)
]
PointValue = Annotated[int, Field(ge=1, le=10000)]
TimeZoneName = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class ItemKind(StrEnum):
    EVENT = "event"
    QUEST = "quest"


class ItemStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"


@lru_cache(maxsize=1)
def _known_time_zones() -> frozenset[str]:
    return frozenset(available_timezones())


def _validate_time_zone(time_zone: str) -> str:
    if time_zone not in _known_time_zones():
        raise ValueError("Must be an IANA time zone name such as Europe/Paris")
    return time_zone


def _validate_time_window(starts_at, ends_at) -> None:
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        raise ValueError("ends_at must be after starts_at")


class ItemCreate(BaseModel):
    """Fields shared by every catalogue item (event or quest)."""

    model_config = ConfigDict(extra="forbid")

    title: ItemTitle
    description: ItemDescription
    location: ItemLocation
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    time_zone: TimeZoneName
    category: ItemCategory

    @field_validator("time_zone")
    @classmethod
    def require_known_time_zone(cls, time_zone: str) -> str:
        return _validate_time_zone(time_zone)

    @model_validator(mode="after")
    def require_valid_window(self) -> ItemCreate:
        _validate_time_window(self.starts_at, self.ends_at)
        return self


class QuestCreate(ItemCreate):
    proof_instructions: ProofInstructions
    point_value: PointValue


class ItemAttributes(BaseModel):
    kind: ItemKind
    owner_id: str
    title: str
    description: str
    location: str
    starts_at: datetime
    ends_at: datetime
    time_zone: str
    category: str
    proof_instructions: str | None
    point_value: int | None
    status: ItemStatus
    published_at: datetime | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ItemResourceData(BaseModel):
    type: Literal["catalogue-items"] = "catalogue-items"
    id: str
    attributes: ItemAttributes
