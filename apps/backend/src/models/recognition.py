from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


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
