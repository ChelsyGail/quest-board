from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.catalogue import ItemKind
from models.catalogue import ItemStatus
from models.catalogue import ParticipationStatus
from models.users import AttendanceVisibility
from services.catalogue_service import from_utc_naive
from services.catalogue_service import item_record_from_row
from services.catalogue_service import ItemRecord
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


class NotAQuestError(Exception):
    """Groups are a quest thing; events only have attendees (BE-34)."""


class NotAParticipantError(Exception):
    """Only students who joined the quest may create or join its groups."""


class GroupNotFoundError(Exception):
    pass


class NotInGroupError(Exception):
    pass


class DuplicateGroupNameError(Exception):
    """Another group on this quest already has that name."""


class AlreadyInAGroupError(Exception):
    """A student belongs to at most one group per quest."""


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


@dataclass(frozen=True)
class GroupRecord:
    group_id: int
    item_id: int
    name: str
    created_by: int
    member_count: int
    created_at: datetime


@dataclass(frozen=True)
class GroupMemberRecord:
    user_id: int
    name: str
    joined_at: datetime


@dataclass(frozen=True)
class MyItemRecord:
    """An item on the student's own list, with how they are involved in it."""

    item: ItemRecord
    participation: ParticipationRecord | None
    saved: bool


SELECT_GROUP_COLUMNS = """
    SELECT g.group_id, g.item_id, g.name, g.created_by, g.created_at,
           (SELECT COUNT(*) FROM group_members AS m WHERE m.group_id = g.group_id)
               AS member_count
    FROM quest_groups AS g
"""

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

    def create_group(self, user_id: int, item_id: int, name: str) -> GroupRecord:
        """Starts a group on a quest the student has joined, with them in it."""
        logger.info(
            "Creating quest group", extra={"user_id": user_id, "item_id": item_id}
        )
        with self.engine.begin() as connection:
            self._require_quest(connection, item_id)
            self._require_participant(connection, user_id, item_id)
            if self._current_group_id(connection, user_id, item_id) is not None:
                raise AlreadyInAGroupError

            try:
                result = connection.execute(
                    text(
                        """
                        INSERT INTO quest_groups (item_id, name, created_by)
                        VALUES (:item_id, :name, :user_id)
                        """
                    ),
                    {"item_id": item_id, "name": name, "user_id": user_id},
                )
            except IntegrityError as error:
                # unique_quest_groups_name
                raise DuplicateGroupNameError from error

            group_id = result.lastrowid
            self._insert_member(connection, group_id, item_id, user_id)
            row = self._load_group(connection, group_id)

        logger.info("Created quest group", extra={"group_id": group_id})
        return self._to_group(row)

    def list_groups(self, item_id: int) -> list[GroupRecord]:
        """The groups on a quest, oldest first, so a student can pick one."""
        with self.engine.connect() as connection:
            self._require_quest(connection, item_id)
            rows = connection.execute(
                text(
                    f"""{SELECT_GROUP_COLUMNS}
                    WHERE g.item_id = :item_id
                    ORDER BY g.created_at, g.group_id
                    """
                ),
                {"item_id": item_id},
            ).all()
        return [self._to_group(row) for row in rows]

    def join_group(self, user_id: int, group_id: int) -> None:
        """Joins an existing group. Joining the group twice changes nothing."""
        logger.info(
            "Joining quest group", extra={"user_id": user_id, "group_id": group_id}
        )
        with self.engine.begin() as connection:
            group = self._lock_group(connection, group_id)
            self._require_quest(connection, group.item_id)
            self._require_participant(connection, user_id, group.item_id)

            current = self._current_group_id(connection, user_id, group.item_id)
            if current == group_id:
                return
            if current is not None:
                raise AlreadyInAGroupError

            self._insert_member(connection, group_id, group.item_id, user_id)

    def leave_group(self, user_id: int, group_id: int) -> None:
        """Leaves a group, and closes it when the last member walks out, so
        abandoned groups do not clutter the quest."""
        logger.info(
            "Leaving quest group", extra={"user_id": user_id, "group_id": group_id}
        )
        with self.engine.begin() as connection:
            self._lock_group(connection, group_id)
            removed = connection.execute(
                text(
                    """
                    DELETE FROM group_members
                    WHERE group_id = :group_id AND user_id = :user_id
                    """
                ),
                {"group_id": group_id, "user_id": user_id},
            ).rowcount
            if removed == 0:
                raise NotInGroupError

            remaining = connection.execute(
                text("SELECT COUNT(*) FROM group_members WHERE group_id = :group_id"),
                {"group_id": group_id},
            ).scalar_one()
            if remaining == 0:
                logger.info("Closing empty quest group", extra={"group_id": group_id})
                connection.execute(
                    text("DELETE FROM quest_groups WHERE group_id = :group_id"),
                    {"group_id": group_id},
                )

    def list_group_members(self, group_id: int) -> list[GroupMemberRecord]:
        """Who is in the group. Names only, in the order they joined."""
        with self.engine.connect() as connection:
            self._load_group(connection, group_id)
            rows = connection.execute(
                text(
                    """
                    SELECT m.user_id, u.name, m.created_at
                    FROM group_members AS m
                    JOIN users AS u ON u.user_id = m.user_id
                    WHERE m.group_id = :group_id AND u.deleted_at IS NULL
                    ORDER BY m.created_at, m.user_id
                    """
                ),
                {"group_id": group_id},
            ).all()
        return [
            GroupMemberRecord(
                user_id=row.user_id,
                name=row.name,
                joined_at=from_utc_naive(row.created_at),
            )
            for row in rows
        ]

    def list_my_items(self, user_id: int) -> list[MyItemRecord]:
        """Everything the student joined or saved, soonest first.

        One list rather than two: the "My quests" screen (FE-33) shows joined
        items with their status next to saved ones, and the participation and
        saved flags say which is which. Archived items stay on the list, because
        a student's own history should not vanish when an organizer tidies up.
        """
        with self.engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT i.*,
                           p.participation_id,
                           p.status AS participation_status,
                           p.created_at AS joined_at,
                           s.user_id AS saved_by
                    FROM catalogue_items AS i
                    LEFT JOIN participations AS p
                           ON p.item_id = i.item_id AND p.user_id = :user_id
                    LEFT JOIN saved_events AS s
                           ON s.item_id = i.item_id AND s.user_id = :user_id
                    WHERE p.participation_id IS NOT NULL OR s.user_id IS NOT NULL
                    ORDER BY i.starts_at, i.item_id
                    """
                ),
                {"user_id": user_id},
            ).all()

        return [
            MyItemRecord(
                item=item_record_from_row(row),
                participation=(
                    ParticipationRecord(
                        participation_id=row.participation_id,
                        user_id=user_id,
                        item_id=row.item_id,
                        status=ParticipationStatus(row.participation_status),
                        joined_at=from_utc_naive(row.joined_at),
                    )
                    if row.participation_id is not None
                    else None
                ),
                saved=row.saved_by is not None,
            )
            for row in rows
        ]

    @staticmethod
    def _insert_member(connection, group_id: int, item_id: int, user_id: int) -> None:
        connection.execute(
            text(
                """
                INSERT INTO group_members (group_id, item_id, user_id)
                VALUES (:group_id, :item_id, :user_id)
                """
            ),
            {"group_id": group_id, "item_id": item_id, "user_id": user_id},
        )

    @staticmethod
    def _current_group_id(connection, user_id: int, item_id: int) -> int | None:
        """The group this student is already in for this quest, if any."""
        return connection.execute(
            text(
                """
                SELECT group_id FROM group_members
                WHERE user_id = :user_id AND item_id = :item_id
                """
            ),
            {"user_id": user_id, "item_id": item_id},
        ).scalar_one_or_none()

    @staticmethod
    def _require_participant(connection, user_id: int, item_id: int) -> None:
        participation = connection.execute(
            text(
                """
                SELECT participation_id FROM participations
                WHERE user_id = :user_id AND item_id = :item_id
                """
            ),
            {"user_id": user_id, "item_id": item_id},
        ).one_or_none()
        if participation is None:
            raise NotAParticipantError

    def _require_quest(self, connection, item_id: int) -> None:
        self._require_visible_item(connection, item_id)
        kind = connection.execute(
            text("SELECT kind FROM catalogue_items WHERE item_id = :item_id"),
            {"item_id": item_id},
        ).scalar_one()
        if kind != ItemKind.QUEST.value:
            raise NotAQuestError

    @staticmethod
    def _lock_group(connection, group_id: int):
        row = connection.execute(
            text(
                "SELECT group_id, item_id FROM quest_groups "
                "WHERE group_id = :group_id FOR UPDATE"
            ),
            {"group_id": group_id},
        ).one_or_none()
        if row is None:
            raise GroupNotFoundError
        return row

    @staticmethod
    def _load_group(connection, group_id: int):
        row = connection.execute(
            text(f"{SELECT_GROUP_COLUMNS} WHERE g.group_id = :group_id"),
            {"group_id": group_id},
        ).one_or_none()
        if row is None:
            raise GroupNotFoundError
        return row

    @staticmethod
    def _to_group(row) -> GroupRecord:
        return GroupRecord(
            group_id=row.group_id,
            item_id=row.item_id,
            name=row.name,
            created_by=row.created_by,
            member_count=row.member_count,
            created_at=from_utc_naive(row.created_at),
        )

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
