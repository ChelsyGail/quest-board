from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from datetime import timezone

from database.connection import create_database_engine
from models.catalogue import ItemCreate
from models.catalogue import ItemKind
from models.catalogue import ItemStatus
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


SELECT_ITEM_COLUMNS = """
    SELECT item_id, owner_id, kind, title, description, location,
           starts_at, ends_at, time_zone, category,
           proof_instructions, point_value, status,
           published_at, archived_at, created_at, updated_at
    FROM catalogue_items
"""


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
