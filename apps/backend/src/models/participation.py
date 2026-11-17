from __future__ import annotations

from datetime import datetime
from typing import Annotated
from typing import Literal

from models.catalogue import ItemAttributes
from models.catalogue import ParticipationStatus
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import StringConstraints


class ParticipationAttributes(BaseModel):
    item_id: str
    user_id: str
    status: ParticipationStatus
    # Twists (BE-26) are not built yet, so this stays null until they land and
    # participations carry the twist the student was given.
    twist: str | None = None
    joined_at: datetime


class ParticipationResourceData(BaseModel):
    type: Literal["participations"] = "participations"
    id: str
    attributes: ParticipationAttributes


class AttendeeAttributes(BaseModel):
    """Only what the attendee list is allowed to show: never an email (BE-32)."""

    name: str


class AttendeeResourceData(BaseModel):
    type: Literal["attendees"] = "attendees"
    id: str
    attributes: AttendeeAttributes


GroupName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]


class GroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: GroupName


class GroupAttributes(BaseModel):
    item_id: str
    name: str
    created_by: str
    member_count: int
    created_at: datetime


class GroupResourceData(BaseModel):
    type: Literal["quest-groups"] = "quest-groups"
    id: str
    attributes: GroupAttributes


class GroupMemberAttributes(BaseModel):
    name: str
    joined_at: datetime


class GroupMemberResourceData(BaseModel):
    type: Literal["group-members"] = "group-members"
    id: str
    attributes: GroupMemberAttributes


class ParticipationSummary(BaseModel):
    """What the student's own participation adds to an item on their list."""

    participation_id: str
    status: ParticipationStatus
    # Null until twists (BE-26) are built, like ParticipationAttributes.twist.
    twist: str | None = None
    joined_at: datetime


class MyItemAttributes(ItemAttributes):
    """A catalogue item plus this student's relationship to it: joined, saved or
    both. The item fields are the same ones the catalogue returns, so the app can
    reuse its item card."""

    participation: ParticipationSummary | None = None
    saved: bool = False


class MyItemResourceData(BaseModel):
    type: Literal["my-items"] = "my-items"
    id: str
    attributes: MyItemAttributes
