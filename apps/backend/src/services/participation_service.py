from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.catalogue import ItemStatus
from models.catalogue import ParticipationStatus
from services.catalogue_service import from_utc_naive
from sqlalchemy import text
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


class ItemNotAvailableError(Exception):
    """The item does not exist, or is not something a student may take part in."""


@dataclass(frozen=True)
class ParticipationRecord:
    participation_id: int
    user_id: int
    item_id: int
    status: ParticipationStatus
    joined_at: datetime


SELECT_PARTICIPATION_COLUMNS = """
    SELECT participation_id, user_id, item_id, status, created_at
    FROM participations
"""


class ParticipationService:
    """Joining, saving and the social side of an item (C3 "Participation")."""

    def __init__(self, settings: DatabaseSettings):
        self.engine = create_database_engine(settings)

    def join_item(self, user_id: int, item_id: int) -> ParticipationRecord:
        """Records that the student is coming: an RSVP to an event, or taking on a
        quest. The participation starts at Joined; proof moves it on later."""
        logger.info("Joining item", extra={"user_id": user_id, "item_id": item_id})
        with self.engine.begin() as connection:
            self._require_visible_item(connection, item_id)
            result = connection.execute(
                text(
                    """
                    INSERT INTO participations (user_id, item_id, status)
                    VALUES (:user_id, :item_id, :status)
                    """
                ),
                {
                    "user_id": user_id,
                    "item_id": item_id,
                    "status": ParticipationStatus.JOINED.value,
                },
            )
            row = self._load_participation(connection, result.lastrowid)

        logger.info(
            "Joined item",
            extra={"participation_id": row.participation_id, "item_id": item_id},
        )
        return self._to_record(row)

    @staticmethod
    def _require_visible_item(connection, item_id: int) -> None:
        """A student may only act on an item they can see: published, not archived.

        Anything else is reported as a 404 rather than a 403, so a draft does not
        leak the fact that it exists.
        """
        row = connection.execute(
            text(
                "SELECT status, archived_at FROM catalogue_items WHERE item_id = :item_id"
            ),
            {"item_id": item_id},
        ).one_or_none()
        if (
            row is None
            or row.status != ItemStatus.PUBLISHED.value
            or row.archived_at is not None
        ):
            raise ItemNotAvailableError

    @staticmethod
    def _load_participation(connection, participation_id: int):
        return connection.execute(
            text(
                f"{SELECT_PARTICIPATION_COLUMNS} WHERE participation_id = :participation_id"
            ),
            {"participation_id": participation_id},
        ).one()

    @staticmethod
    def _to_record(row) -> ParticipationRecord:
        return ParticipationRecord(
            participation_id=row.participation_id,
            user_id=row.user_id,
            item_id=row.item_id,
            status=ParticipationStatus(row.status),
            joined_at=from_utc_naive(row.created_at),
        )
