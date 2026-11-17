"""Recognition (C3): points and badges earned through approved quests.

The award functions take the caller's connection, because they run inside the
approval transaction (BE-46): the review, the Approved status and the awards
commit together or not at all.

Points are never stored as a running total (BE-55). totalPoints is the sum of
point_awards; availablePoints is that minus the debits in points_ledger.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.recognition import RuleType
from services.catalogue_service import from_utc_naive
from services.recognition_rules import evaluate
from services.recognition_rules import load_stats
from services.recognition_rules import Rule
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


@dataclass(frozen=True)
class BadgeAwardRecord:
    badge_award_id: int
    badge_id: int
    user_id: int
    name: str
    description: str
    awarded_at: datetime


@dataclass(frozen=True)
class PointBalance:
    # Lifetime earned points (the UML /totalPoints). Claims never lower it.
    total_points: int
    # Earned minus committed debits: what is left to spend on rewards.
    available_points: int


def load_balance(connection, user_id: int) -> PointBalance:
    """Both values from the database on the caller's connection. Inside the
    claim transaction this runs after the per-user lock, so it is current."""
    row = connection.execute(
        text(
            """
            SELECT
                (SELECT COALESCE(SUM(points), 0) FROM point_awards
                 WHERE user_id = :user_id) AS earned,
                (SELECT COALESCE(SUM(amount), 0) FROM points_ledger
                 WHERE user_id = :user_id) AS spent
            """
        ),
        {"user_id": user_id},
    ).one()
    earned = int(row.earned)
    return PointBalance(total_points=earned, available_points=earned - int(row.spent))


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


def award_earned_badges(
    connection, user_id: int, participation_id: int
) -> list[BadgeAwardRecord]:
    """BE-56: awards every badge the student now meets and does not have yet.

    Runs inside the approval transaction, after award_points, so the new award
    counts. That transaction holds the student's users-row lock, so no other
    approval for the same student can check the same badges at the same time.
    unique_badge_awards_user_badge stays as the final guard.
    """
    candidates = connection.execute(
        text(
            """
            SELECT b.badge_id, b.rule_type, b.rule_threshold, b.rule_category
            FROM badges AS b
            WHERE NOT EXISTS (
                SELECT 1 FROM badge_awards AS a
                WHERE a.badge_id = b.badge_id AND a.user_id = :user_id
            )
            ORDER BY b.badge_id
            """
        ),
        {"user_id": user_id},
    ).all()
    if not candidates:
        return []

    stats = load_stats(connection, user_id)
    earned_ids = [
        badge.badge_id for badge in candidates if evaluate(badge_rule(badge), stats).met
    ]
    for badge_id in earned_ids:
        connection.execute(
            text(
                """
                INSERT INTO badge_awards (user_id, badge_id, participation_id)
                VALUES (:user_id, :badge_id, :participation_id)
                """
            ),
            {
                "user_id": user_id,
                "badge_id": badge_id,
                "participation_id": participation_id,
            },
        )
    if earned_ids:
        logger.info(
            "Awarded badges",
            extra={"user_id": user_id, "badge_ids": earned_ids},
        )
    return load_badges_for_participation(connection, participation_id)


def load_badges_for_participation(
    connection, participation_id: int
) -> list[BadgeAwardRecord]:
    """The badges a given approval earned (also used to answer a retry)."""
    rows = connection.execute(
        text(
            """
            SELECT a.badge_award_id, a.badge_id, a.user_id, a.created_at,
                   b.name, b.description
            FROM badge_awards AS a
            JOIN badges AS b ON b.badge_id = a.badge_id
            WHERE a.participation_id = :participation_id
            ORDER BY a.badge_id
            """
        ),
        {"participation_id": participation_id},
    ).all()
    return [to_badge_award(row) for row in rows]


def badge_rule(row) -> Rule:
    return Rule(
        type=RuleType(row.rule_type),
        threshold=row.rule_threshold,
        category=row.rule_category,
    )


def to_badge_award(row) -> BadgeAwardRecord:
    return BadgeAwardRecord(
        badge_award_id=row.badge_award_id,
        badge_id=row.badge_id,
        user_id=row.user_id,
        name=row.name,
        description=row.description,
        awarded_at=from_utc_naive(row.created_at),
    )


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

    def get_balance(self, user_id: int) -> PointBalance:
        with self.engine.connect() as connection:
            return load_balance(connection, user_id)

    def award_points_for(self, participation_id: int) -> PointAwardRecord:
        """award_points in a transaction of its own, for callers outside the
        approval flow (jobs, tests)."""
        with self.engine.begin() as connection:
            return award_points(connection, participation_id)
