from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.catalogue import ParticipationStatus
from services.catalogue_service import from_utc_naive
from sqlalchemy import text
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class QueueEntry:
    submission_id: int
    participation_id: int
    item_id: int
    item_title: str
    user_id: int
    student_name: str
    attempt_number: int
    has_text: bool
    media_count: int
    submitted_at: datetime


@dataclass(frozen=True)
class QueuePage:
    entries: list[QueueEntry]
    page_number: int
    page_size: int
    total_items: int

    @property
    def total_pages(self) -> int:
        return -(-self.total_items // self.page_size)


# The attempt a moderator has to decide is the participation's current one, and
# only while the participation is Pending (BE-39, BE-40).
PENDING_FROM = """
    FROM participations AS p
    JOIN submissions AS s ON s.submission_id = p.current_submission_id
    JOIN users AS u ON u.user_id = p.user_id
    JOIN catalogue_items AS i ON i.item_id = p.item_id
    WHERE p.status = :pending
"""


class ReviewService:
    """Moderation (C3 "Proof and Review", the moderator side)."""

    def __init__(self, settings: DatabaseSettings):
        self.engine = create_database_engine(settings)

    def list_pending(self, page_number: int, page_size: int) -> QueuePage:
        """BE-44: attempts waiting for a decision, oldest first, so nobody waits
        behind students who submitted later. Ties go to the lower id, so pages
        never overlap or skip rows."""
        parameters = {
            "pending": ParticipationStatus.PENDING.value,
            "limit": page_size,
            "offset": (page_number - 1) * page_size,
        }
        with self.engine.connect() as connection:
            total_items = connection.execute(
                text(f"SELECT COUNT(*) {PENDING_FROM}"), parameters
            ).scalar_one()
            rows = connection.execute(
                # Plain strings joined with `+` rather than a multi-line f-string:
                # flake8 6.0 misreads multi-line f-strings on Python 3.12 (E241).
                text(
                    """
                    SELECT s.submission_id, s.participation_id, s.attempt_number,
                           s.created_at, s.text_proof IS NOT NULL AS has_text,
                           p.user_id, p.item_id, u.name AS student_name,
                           i.title AS item_title,
                           (SELECT COUNT(*) FROM submission_media AS m
                            WHERE m.submission_id = s.submission_id) AS media_count
                    """
                    + PENDING_FROM
                    + """
                    ORDER BY s.created_at, s.submission_id
                    LIMIT :limit OFFSET :offset
                    """
                ),
                parameters,
            ).all()

        return QueuePage(
            entries=[
                QueueEntry(
                    submission_id=row.submission_id,
                    participation_id=row.participation_id,
                    item_id=row.item_id,
                    item_title=row.item_title,
                    user_id=row.user_id,
                    student_name=row.student_name,
                    attempt_number=row.attempt_number,
                    has_text=bool(row.has_text),
                    media_count=row.media_count,
                    submitted_at=from_utc_naive(row.created_at),
                )
                for row in rows
            ],
            page_number=page_number,
            page_size=page_size,
            total_items=total_items,
        )
