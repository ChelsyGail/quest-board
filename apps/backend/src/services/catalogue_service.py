from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from datetime import timezone

from database.connection import create_database_engine
from models.catalogue import EventCreate
from models.catalogue import ItemCreate
from models.catalogue import ItemKind
from models.catalogue import ItemStatus
from models.catalogue import ItemUpdate
from models.catalogue import ParticipationStatus
from models.catalogue import QUEST_ONLY_FIELDS
from models.catalogue import QuestCreate
from sqlalchemy import text
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


class ItemNotFoundError(Exception):
    pass


class ItemOwnershipError(Exception):
    """The caller is not the organizer who owns the item."""


class ItemAlreadyPublishedError(Exception):
    pass


class ItemArchivedError(Exception):
    pass


class InvalidTimeWindowError(Exception):
    """After the update, ends_at would not be after starts_at."""


class QuestOnlyFieldError(Exception):
    """A quest-only field was sent for an event."""

    def __init__(self, fields: list[str]):
        super().__init__(fields)
        self.fields = fields


@dataclass(frozen=True)
class ItemRecord:
    item_id: int
    owner_id: int
    kind: ItemKind
    title: str
    description: str
    location: str
    starts_at: datetime
    ends_at: datetime
    time_zone: str
    category: str
    proof_instructions: str | None
    point_value: int | None
    status: ItemStatus
    published_at: datetime | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @property
    def is_visible(self) -> bool:
        return self.status == ItemStatus.PUBLISHED and self.archived_at is None


@dataclass(frozen=True)
class ItemPage:
    """One page of the public catalogue plus the totals the client needs to page."""

    items: list[ItemRecord]
    page_number: int
    page_size: int
    total_items: int

    @property
    def total_pages(self) -> int:
        return -(-self.total_items // self.page_size)


@dataclass(frozen=True)
class ParticipantRecord:
    participation_id: int
    user_id: int
    name: str
    status: ParticipationStatus
    joined_at: datetime


SELECT_ITEM_COLUMNS = """
    SELECT item_id, owner_id, kind, title, description, location,
           starts_at, ends_at, time_zone, category,
           proof_instructions, point_value, status,
           published_at, archived_at, created_at, updated_at
    FROM catalogue_items
"""

# Published, not archived and not yet over. Matches index_catalogue_items_visible
# (status, archived_at, starts_at) so the list stays an index range scan (BE-26).
VISIBLE_UPCOMING_FILTER = """
    WHERE status = :status
      AND archived_at IS NULL
      AND ends_at > :now
"""

UPDATABLE_FIELDS = (
    "title",
    "description",
    "location",
    "starts_at",
    "ends_at",
    "time_zone",
    "category",
    "proof_instructions",
    "point_value",
)


def to_utc_naive(value: datetime) -> datetime:
    """MySQL DATETIME has no zone; everything is stored as UTC wall-clock time."""
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def from_utc_naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc)


class CatalogueService:
    def __init__(self, settings: DatabaseSettings):
        self.engine = create_database_engine(settings)

    def create_event(self, owner_id: int, event: EventCreate) -> ItemRecord:
        return self._create_item(owner_id, ItemKind.EVENT, event)

    def create_quest(self, owner_id: int, quest: QuestCreate) -> ItemRecord:
        return self._create_item(owner_id, ItemKind.QUEST, quest)

    def _create_item(
        self, owner_id: int, kind: ItemKind, item: ItemCreate
    ) -> ItemRecord:
        logger.info(
            "Creating catalogue item",
            extra={"owner_id": owner_id, "kind": kind.value},
        )
        parameters = {
            "owner_id": owner_id,
            "kind": kind.value,
            "title": item.title,
            "description": item.description,
            "location": item.location,
            "starts_at": to_utc_naive(item.starts_at),
            "ends_at": to_utc_naive(item.ends_at),
            "time_zone": item.time_zone,
            "category": item.category,
            "proof_instructions": getattr(item, "proof_instructions", None),
            "point_value": getattr(item, "point_value", None),
        }
        with self.engine.begin() as connection:
            result = connection.execute(
                text(
                    """
                    INSERT INTO catalogue_items (
                        owner_id, kind, title, description, location,
                        starts_at, ends_at, time_zone, category,
                        proof_instructions, point_value
                    )
                    VALUES (
                        :owner_id, :kind, :title, :description, :location,
                        :starts_at, :ends_at, :time_zone, :category,
                        :proof_instructions, :point_value
                    )
                    """
                ),
                parameters,
            )
            row = self._load_item(connection, result.lastrowid)

        logger.info(
            "Created catalogue item",
            extra={"item_id": row.item_id, "kind": kind.value},
        )
        return self._to_record(row)

    def get_item(self, item_id: int, viewer_id: int) -> ItemRecord:
        """Owners see their own drafts; everyone else only sees published, unarchived items."""
        with self.engine.connect() as connection:
            row = connection.execute(
                text(f"{SELECT_ITEM_COLUMNS} WHERE item_id = :item_id"),
                {"item_id": item_id},
            ).one_or_none()
        if row is None:
            raise ItemNotFoundError
        record = self._to_record(row)
        if record.owner_id != viewer_id and not record.is_visible:
            raise ItemNotFoundError
        return record

    def list_my_items(self, owner_id: int) -> list[ItemRecord]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                text(
                    f"""
                    {SELECT_ITEM_COLUMNS}
                    WHERE owner_id = :owner_id AND archived_at IS NULL
                    ORDER BY starts_at, item_id
                    """
                ),
                {"owner_id": owner_id},
            ).all()
        return [self._to_record(row) for row in rows]

    def list_published_items(
        self, page_number: int, page_size: int, now: datetime | None = None
    ) -> ItemPage:
        """Students' catalogue: published, unarchived items that have not ended yet,
        soonest first. Ties on starts_at are broken by item_id so pages never
        overlap or skip rows."""
        parameters = {
            "status": ItemStatus.PUBLISHED.value,
            "now": to_utc_naive(now or datetime.now(timezone.utc)),
            "limit": page_size,
            "offset": (page_number - 1) * page_size,
        }
        with self.engine.connect() as connection:
            total_items = connection.execute(
                text(f"SELECT COUNT(*) FROM catalogue_items {VISIBLE_UPCOMING_FILTER}"),
                parameters,
            ).scalar_one()
            rows = connection.execute(
                text(
                    f"""
                    {SELECT_ITEM_COLUMNS}
                    {VISIBLE_UPCOMING_FILTER}
                    ORDER BY starts_at, item_id
                    LIMIT :limit OFFSET :offset
                    """
                ),
                parameters,
            ).all()

        return ItemPage(
            items=[self._to_record(row) for row in rows],
            page_number=page_number,
            page_size=page_size,
            total_items=total_items,
        )

    def update_item(
        self, item_id: int, actor_id: int, update: ItemUpdate
    ) -> ItemRecord:
        changes = update.model_dump(exclude_unset=True)
        for field in ("starts_at", "ends_at"):
            if field in changes:
                changes[field] = to_utc_naive(changes[field])

        logger.info(
            "Updating catalogue item",
            extra={"item_id": item_id, "actor_id": actor_id, "fields": sorted(changes)},
        )
        with self.engine.begin() as connection:
            current = self._to_record(
                self._lock_owned_item(connection, item_id, actor_id)
            )

            if current.kind == ItemKind.EVENT:
                rejected = sorted(QUEST_ONLY_FIELDS.intersection(changes))
                if rejected:
                    raise QuestOnlyFieldError(rejected)

            # Both ends of the window must stay consistent when only one is changed.
            starts_at = changes.get("starts_at", to_utc_naive(current.starts_at))
            ends_at = changes.get("ends_at", to_utc_naive(current.ends_at))
            if ends_at <= starts_at:
                raise InvalidTimeWindowError

            assignments = [
                f"{field} = :{field}" for field in UPDATABLE_FIELDS if field in changes
            ]
            assignments.append("updated_at = CURRENT_TIMESTAMP(6)")
            connection.execute(
                text(
                    f"""
                    UPDATE catalogue_items
                    SET {", ".join(assignments)}
                    WHERE item_id = :item_id
                    """
                ),
                {**changes, "item_id": item_id},
            )
            row = self._load_item(connection, item_id)

        logger.info("Updated catalogue item", extra={"item_id": item_id})
        return self._to_record(row)

    def publish_item(self, item_id: int, actor_id: int) -> ItemRecord:
        logger.info(
            "Publishing catalogue item",
            extra={"item_id": item_id, "actor_id": actor_id},
        )
        with self.engine.begin() as connection:
            row = self._lock_owned_item(connection, item_id, actor_id)
            if row.status == ItemStatus.PUBLISHED:
                raise ItemAlreadyPublishedError

            connection.execute(
                text(
                    """
                    UPDATE catalogue_items
                    SET status = :status,
                        published_at = CURRENT_TIMESTAMP(6),
                        updated_at = CURRENT_TIMESTAMP(6)
                    WHERE item_id = :item_id
                    """
                ),
                {"status": ItemStatus.PUBLISHED.value, "item_id": item_id},
            )
            row = self._load_item(connection, item_id)

        logger.info("Published catalogue item", extra={"item_id": item_id})
        return self._to_record(row)

    def list_participants(self, item_id: int, actor_id: int) -> list[ParticipantRecord]:
        with self.engine.connect() as connection:
            row = connection.execute(
                text("SELECT owner_id FROM catalogue_items WHERE item_id = :item_id"),
                {"item_id": item_id},
            ).one_or_none()
            if row is None:
                raise ItemNotFoundError
            if row.owner_id != actor_id:
                raise ItemOwnershipError

            rows = connection.execute(
                text(
                    """
                    SELECT p.participation_id, p.user_id, u.name, p.status, p.created_at
                    FROM participations AS p
                    JOIN users AS u ON u.user_id = p.user_id
                    WHERE p.item_id = :item_id AND u.deleted_at IS NULL
                    ORDER BY p.created_at, p.participation_id
                    """
                ),
                {"item_id": item_id},
            ).all()

        return [
            ParticipantRecord(
                participation_id=r.participation_id,
                user_id=r.user_id,
                name=r.name,
                status=ParticipationStatus(r.status),
                joined_at=from_utc_naive(r.created_at),
            )
            for r in rows
        ]

    @staticmethod
    def _lock_owned_item(connection, item_id: int, actor_id: int):
        """Loads an item for change, enforcing existence, ownership and archive state."""
        row = connection.execute(
            text(f"{SELECT_ITEM_COLUMNS} WHERE item_id = :item_id FOR UPDATE"),
            {"item_id": item_id},
        ).one_or_none()
        if row is None:
            raise ItemNotFoundError
        if row.owner_id != actor_id:
            logger.warning(
                "Rejected change to another organizer's item",
                extra={"item_id": item_id, "actor_id": actor_id},
            )
            raise ItemOwnershipError
        if row.archived_at is not None:
            raise ItemArchivedError
        return row

    @staticmethod
    def _load_item(connection, item_id: int):
        return connection.execute(
            text(f"{SELECT_ITEM_COLUMNS} WHERE item_id = :item_id"),
            {"item_id": item_id},
        ).one()

    @staticmethod
    def _to_record(row) -> ItemRecord:
        return ItemRecord(
            item_id=row.item_id,
            owner_id=row.owner_id,
            kind=ItemKind(row.kind),
            title=row.title,
            description=row.description,
            location=row.location,
            starts_at=from_utc_naive(row.starts_at),
            ends_at=from_utc_naive(row.ends_at),
            time_zone=row.time_zone,
            category=row.category,
            proof_instructions=row.proof_instructions,
            point_value=row.point_value,
            status=ItemStatus(row.status),
            published_at=from_utc_naive(row.published_at),
            archived_at=from_utc_naive(row.archived_at),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
