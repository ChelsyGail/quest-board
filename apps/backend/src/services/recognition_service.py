"""Recognition (C3): points and badges earned through approved quests.

The award functions take the caller's connection, because they run inside the
approval transaction (BE-46): the review, the Approved status and the awards
commit together or not at all.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from services.catalogue_service import from_utc_naive
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


class DuplicateAwardError(Exception):
    """This participation already earned its points (BE-54)."""


@dataclass(frozen=True)
class PointAwardRecord:
    point_award_id: int
    participation_id: int
    user_id: int
    item_id: int
    points: int
    awarded_at: datetime


def award_points(connection, participation_id: int) -> PointAwardRecord:
    """Awards the quest's current point value to the participation's student.

    The amount is read from the quest now and stored on the award, so it is a
    snapshot taken at approval time. A second award for the same participation
    hits unique_point_awards_participation and raises DuplicateAwardError.
    """
    participation = connection.execute(
        text(
            """
            SELECT p.participation_id, p.user_id, p.item_id, i.point_value
            FROM participations AS p
            JOIN catalogue_items AS i ON i.item_id = p.item_id
            WHERE p.participation_id = :participation_id
            """
        ),
        {"participation_id": participation_id},
    ).one()
    try:
        result = connection.execute(
            text(
                """
                INSERT INTO point_awards (participation_id, user_id, item_id, points)
                VALUES (:participation_id, :user_id, :item_id, :points)
                """
            ),
            {
                "participation_id": participation.participation_id,
                "user_id": participation.user_id,
                "item_id": participation.item_id,
                "points": participation.point_value or 0,
            },
        )
    except IntegrityError as error:
        logger.warning(
            "Duplicate point award refused",
            extra={"participation_id": participation_id},
        )
        raise DuplicateAwardError from error

    row = connection.execute(
        text("SELECT * FROM point_awards WHERE point_award_id = :id"),
        {"id": result.lastrowid},
    ).one()
    logger.info(
        "Awarded points",
        extra={
            "participation_id": participation_id,
            "user_id": participation.user_id,
            "points": row.points,
        },
    )
    return _to_point_award(row)


def _to_point_award(row) -> PointAwardRecord:
    return PointAwardRecord(
        point_award_id=row.point_award_id,
        participation_id=row.participation_id,
        user_id=row.user_id,
        item_id=row.item_id,
        points=row.points,
        awarded_at=from_utc_naive(row.created_at),
    )


class RecognitionService:
    def __init__(self, settings: DatabaseSettings):
        self.engine = create_database_engine(settings)

    def award_points_for(self, participation_id: int) -> PointAwardRecord:
        """award_points in a transaction of its own, for callers outside the
        approval flow (jobs, tests)."""
        with self.engine.begin() as connection:
            return award_points(connection, participation_id)
