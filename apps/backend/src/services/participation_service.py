from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.catalogue import ItemStatus
from models.catalogue import ParticipationStatus
from models.users import AttendanceVisibility
from services.catalogue_service import from_utc_naive
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


class ItemNotAvailableError(Exception):
    """The item does not exist, or is not something a student may take part in."""


class AlreadyJoinedError(Exception):
    """The student already has a participation for this item (BE-28)."""


class NotJoinedError(Exception):
    """The student has no participation for this item."""


class ParticipationLockedError(Exception):
    """The attempt has moved past Joined, so leaving would discard its history."""


@dataclass(frozen=True)
class ParticipationRecord:
    participation_id: int
    user_id: int
    item_id: int
    status: ParticipationStatus
    joined_at: datetime


@dataclass(frozen=True)
class AttendeeRecord:
    participation_id: int
    name: str


@dataclass(frozen=True)
class AttendeeList:
    """Named attendees plus a count of the ones who chose to stay hidden."""

    attendees: list[AttendeeRecord]
    hidden_count: int

    @property
    def total_count(self) -> int:
        return len(self.attendees) + self.hidden_count


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
        quest. The participation starts at Joined; proof moves it on later.

        One participation per student and item: a second join raises
        AlreadyJoinedError, whether it arrives a minute or a millisecond later.
        """
        logger.info("Joining item", extra={"user_id": user_id, "item_id": item_id})
        try:
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
        except IntegrityError as error:
            # unique_participations_user_item is what settles a race between two
            # joins: the loser lands here rather than creating a second record.
            logger.info(
                "Duplicate join rejected",
                extra={"user_id": user_id, "item_id": item_id},
            )
            raise AlreadyJoinedError from error

        logger.info(
            "Joined item",
            extra={"participation_id": row.participation_id, "item_id": item_id},
        )
        return self._to_record(row)

    def leave_item(self, user_id: int, item_id: int) -> None:
        """Drops the student's participation so their plans and reminders match.

        Refused once the participation has moved past Joined: Pending, Approved
        and Rejected all mean proof was submitted, and that history has to
        survive (BE-31). When the submissions table lands with the proof
        tickets, this check becomes "a submission exists for this attempt".
        """
        logger.info("Leaving item", extra={"user_id": user_id, "item_id": item_id})
        with self.engine.begin() as connection:
            row = connection.execute(
                text(
                    f"""{SELECT_PARTICIPATION_COLUMNS}
                    WHERE user_id = :user_id AND item_id = :item_id
                    FOR UPDATE
                    """
                ),
                {"user_id": user_id, "item_id": item_id},
            ).one_or_none()
            if row is None:
                raise NotJoinedError
            if row.status != ParticipationStatus.JOINED.value:
                logger.info(
                    "Refused to leave an item with proof behind it",
                    extra={
                        "participation_id": row.participation_id,
                        "status": row.status,
                    },
                )
                raise ParticipationLockedError

            connection.execute(
                text(
                    "DELETE FROM participations WHERE participation_id = :participation_id"
                ),
                {"participation_id": row.participation_id},
            )

        logger.info("Left item", extra={"user_id": user_id, "item_id": item_id})

    def save_item(self, user_id: int, item_id: int) -> None:
        """Bookmarks the item without joining it, so the student still gets its
        reminders. Saving something already saved changes nothing (BE-30)."""
        logger.info("Saving item", extra={"user_id": user_id, "item_id": item_id})
        with self.engine.begin() as connection:
            self._require_visible_item(connection, item_id)
            connection.execute(
                text(
                    """
                    INSERT INTO saved_events (user_id, item_id)
                    VALUES (:user_id, :item_id)
                    ON DUPLICATE KEY UPDATE item_id = item_id
                    """
                ),
                {"user_id": user_id, "item_id": item_id},
            )

    def unsave_item(self, user_id: int, item_id: int) -> None:
        """Removes the bookmark.

        Deliberately not checked against item visibility: a student must be able
        to un-save an item the organizer has since archived. Un-saving something
        that was never saved is a no-op rather than an error.
        """
        logger.info("Un-saving item", extra={"user_id": user_id, "item_id": item_id})
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    DELETE FROM saved_events
                    WHERE user_id = :user_id AND item_id = :item_id
                    """
                ),
                {"user_id": user_id, "item_id": item_id},
            )

    def list_attendees(self, item_id: int) -> AttendeeList:
        """Who else is coming, so a student does not have to turn up alone.

        Students whose visibility is 'hidden' are counted but not named, and the
        query selects no email at all: there is no payload shape in which one
        could leak (BE-32).
        """
        with self.engine.connect() as connection:
            self._require_visible_item(connection, item_id)
            rows = connection.execute(
                text(
                    """
                    SELECT p.participation_id, u.name, u.attendance_visibility
                    FROM participations AS p
                    JOIN users AS u ON u.user_id = p.user_id
                    WHERE p.item_id = :item_id AND u.deleted_at IS NULL
                    ORDER BY p.created_at, p.participation_id
                    """
                ),
                {"item_id": item_id},
            ).all()

        named = [
            AttendeeRecord(participation_id=row.participation_id, name=row.name)
            for row in rows
            if row.attendance_visibility == AttendanceVisibility.VISIBLE.value
        ]
        return AttendeeList(attendees=named, hidden_count=len(rows) - len(named))

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
