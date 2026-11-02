from __future__ import annotations

from datetime import datetime
from typing import Literal

from models.catalogue import ParticipationStatus
from pydantic import BaseModel


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
