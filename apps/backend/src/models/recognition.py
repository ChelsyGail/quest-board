from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class RuleType(StrEnum):
    """What a badge's criteria (BE-56) counts."""

    APPROVED_QUESTS = "approved_quests"
    TOTAL_POINTS = "total_points"
    CATEGORY_QUESTS = "category_quests"


class BadgeSummary(BaseModel):
    badge_id: str
    name: str
    description: str
    awarded_at: datetime


class PointsAttributes(BaseModel):
    """Both values are worked out on the server from awards and debits (BE-55);
    no endpoint accepts them from the client."""

    # Lifetime earned points: the UML /totalPoints. Spending never lowers it.
    total_points: int
    # What the student can still spend on rewards: earned minus spent.
    available_points: int


class PointsResourceData(BaseModel):
    type: Literal["points"] = "points"
    id: str
    attributes: PointsAttributes


class CompletedQuest(BaseModel):
    item_id: str
    title: str
    category: str
    # The amount awarded when the approval committed (a snapshot, BE-54).
    points: int
    approved_at: datetime


class AchievementsAttributes(BaseModel):
    """BE-57: everything the achievements screen shows, for the signed-in
    student. Points come from awards and debits, never from the client."""

    total_points: int
    available_points: int
    badges: list[BadgeSummary]
    # Newest approval first.
    completed_quests: list[CompletedQuest]


class AchievementsResourceData(BaseModel):
    type: Literal["achievements"] = "achievements"
    id: str
    attributes: AchievementsAttributes
