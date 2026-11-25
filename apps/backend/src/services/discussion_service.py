from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.catalogue import ItemKind
from models.catalogue import ItemStatus
from models.catalogue import ParticipationStatus
from models.discussion import GROVE_CATEGORIES
from models.discussion import QUEST_CATEGORIES
from services.catalogue_service import from_utc_naive
from sqlalchemy import bindparam
from sqlalchemy import text
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)

MAX_PAGE_SIZE = 50
PROOF_PHASE_STATUSES = frozenset(
    {
        ParticipationStatus.PENDING.value,
        ParticipationStatus.APPROVED.value,
        ParticipationStatus.REJECTED.value,
    }
)

QUEST_SCOPE_PATTERN = re.compile(r"^quest:(\d+):(active|submitted)$")
LEGACY_QUEST_SCOPE_PATTERN = re.compile(r"^quest:(\d+)$")


class DiscussionValidationError(Exception):
    pass


class ItemNotFoundError(Exception):
    pass


class ThreadNotFoundError(Exception):
    pass


class NotAMemberError(Exception):
    pass


class ScopeAccessDeniedError(Exception):
    """The caller's participation does not match the requested quest space."""


@dataclass(frozen=True)
class DiscussionAuthor:
    user_id: int
    name: str


@dataclass(frozen=True)
class ThreadRecord:
    thread_id: int
    scope: str
    title: str
    category: str
    body: str
    author: DiscussionAuthor
    created_at: datetime
    reply_count: int


@dataclass(frozen=True)
class ReplyRecord:
    reply_id: int
    thread_id: int
    body: str
    author: DiscussionAuthor
    created_at: datetime


@dataclass(frozen=True)
class ThreadPage:
    threads: list[ThreadRecord]
    page_number: int
    page_size: int
    total_items: int
    total_pages: int


@dataclass(frozen=True)
class ReplyPage:
    replies: list[ReplyRecord]
    page_number: int
    page_size: int
    total_items: int
    total_pages: int


@dataclass(frozen=True)
class ThreadDetail:
    thread: ThreadRecord
    replies: ReplyPage


def canonical_quest_scope(item_id: int, space: str) -> str:
    return f"quest:{item_id}:{space}"


def list_scope_values(scope: str) -> list[str]:
    match = QUEST_SCOPE_PATTERN.match(scope)
    if match:
        item_id, space = match.group(1), match.group(2)
        if space == "submitted":
            return [scope, f"quest:{item_id}"]
        return [scope]
    if scope == "grove":
        return ["grove"]
    legacy = LEGACY_QUEST_SCOPE_PATTERN.match(scope)
    if legacy:
        return [scope]
    raise DiscussionValidationError(f"Unknown scope: {scope}")


def parse_quest_route(item_id: int, space: str) -> str:
    if space not in {"active", "submitted"}:
        raise DiscussionValidationError(f"Unknown quest discussion space: {space}")
    return canonical_quest_scope(item_id, space)


def _confirmed_submission(status: str, current_submission_id: int | None) -> bool:
    return status in PROOF_PHASE_STATUSES or current_submission_id is not None


def _user_quest_space_value(
    status: str, current_submission_id: int | None
) -> str:
    if _confirmed_submission(status, current_submission_id):
        return "submitted"
    if status == ParticipationStatus.JOINED.value:
        return "active"
    return "none"


def scope_for_category_check(scope: str) -> tuple[str, frozenset[str]]:
    if scope == "grove":
        return scope, GROVE_CATEGORIES
    if QUEST_SCOPE_PATTERN.match(scope) or LEGACY_QUEST_SCOPE_PATTERN.match(scope):
        return scope, QUEST_CATEGORIES
    raise DiscussionValidationError(f"Unknown scope: {scope}")


class DiscussionService:
    def __init__(self, settings: DatabaseSettings):
        self.engine = create_database_engine(settings)

    def list_threads(
        self,
        user_id: int,
        scope: str,
        *,
        query: str | None = None,
        category: str | None = None,
        page_number: int = 1,
        page_size: int = 20,
    ) -> ThreadPage:
        page_size = min(max(page_size, 1), MAX_PAGE_SIZE)
        self._authorize_scope(user_id, scope)
        scopes = list_scope_values(scope)
        parameters: dict = {
            "scopes": scopes,
            "user_id": user_id,
            "limit": page_size,
            "offset": (page_number - 1) * page_size,
        }
        filters = "t.deleted_at IS NULL AND t.scope IN :scopes"
        if category:
            filters += " AND t.category = :category"
            parameters["category"] = category
        if query:
            filters += " AND (LOWER(t.title) LIKE :needle OR LOWER(t.body) LIKE :needle)"
            parameters["needle"] = f"%{query.strip().lower()}%"

        scope_clause = text(
            f"""
            SELECT COUNT(*) AS total
            FROM discussion_threads AS t
            WHERE {filters}
            """
        ).bindparams(bindparam("scopes", expanding=True))
        list_clause = text(
            f"""
            SELECT t.thread_id, t.scope, t.title, t.category, t.body,
                   t.author_user_id, u.name AS author_name, t.created_at,
                   (SELECT COUNT(*)
                    FROM discussion_replies AS r
                    WHERE r.thread_id = t.thread_id AND r.deleted_at IS NULL)
                       AS reply_count
            FROM discussion_threads AS t
            JOIN users AS u ON u.user_id = t.author_user_id
            WHERE {filters}
            ORDER BY t.created_at DESC, t.thread_id DESC
            LIMIT :limit OFFSET :offset
            """
        ).bindparams(bindparam("scopes", expanding=True))

        with self.engine.connect() as connection:
            total = connection.execute(scope_clause, parameters).scalar_one()
            rows = connection.execute(list_clause, parameters).all()

        threads = [self._thread_from_row(row) for row in rows]
        total_pages = max(1, (total + page_size - 1) // page_size) if total else 0
        if total == 0:
            total_pages = 0
        return ThreadPage(
            threads=threads,
            page_number=page_number,
            page_size=page_size,
            total_items=total,
            total_pages=total_pages,
        )

    def create_thread(
        self,
        user_id: int,
        scope: str,
        *,
        title: str,
        category: str,
        body: str,
    ) -> ThreadRecord:
        title = (title or "").strip()
        body = (body or "").strip()
        if len(title) < 3:
            raise DiscussionValidationError("Title must be at least 3 characters.")
        if not body:
            raise DiscussionValidationError("Message cannot be empty.")
        allowed = scope_for_category_check(scope)[1]
        if category not in allowed:
            raise DiscussionValidationError("Invalid category for this scope.")

        item_id = self._item_id_for_scope(scope)
        with self.engine.begin() as connection:
            # Re-check membership inside the write transaction so a proof submit
            # between an earlier check and this insert cannot leave a stale active post.
            self._authorize_scope_on_connection(
                connection, user_id, scope, write=True, lock_participation=True
            )
            row = connection.execute(
                text(
                    """
                    INSERT INTO discussion_threads
                        (scope, item_id, title, category, body, author_user_id)
                    VALUES
                        (:scope, :item_id, :title, :category, :body, :author_user_id)
                    """
                ),
                {
                    "scope": scope,
                    "item_id": item_id,
                    "title": title,
                    "category": category,
                    "body": body,
                    "author_user_id": user_id,
                },
            )
            thread_id = row.lastrowid
            loaded = connection.execute(
                text(
                    """
                    SELECT t.thread_id, t.scope, t.title, t.category, t.body,
                           t.author_user_id, u.name AS author_name, t.created_at,
                           0 AS reply_count
                    FROM discussion_threads AS t
                    JOIN users AS u ON u.user_id = t.author_user_id
                    WHERE t.thread_id = :thread_id
                    """
                ),
                {"thread_id": thread_id},
            ).one()
        logger.info(
            "Created discussion thread",
            extra={"thread_id": thread_id, "scope": scope, "user_id": user_id},
        )
        return self._thread_from_row(loaded)

    def get_thread(
        self,
        user_id: int,
        thread_id: int,
        *,
        page_number: int = 1,
        page_size: int = 20,
    ) -> ThreadDetail:
        page_size = min(max(page_size, 1), MAX_PAGE_SIZE)
        with self.engine.connect() as connection:
            thread_row = connection.execute(
                text(
                    """
                    SELECT t.thread_id, t.scope, t.title, t.category, t.body,
                           t.author_user_id, u.name AS author_name, t.created_at,
                           (SELECT COUNT(*)
                            FROM discussion_replies AS r
                            WHERE r.thread_id = t.thread_id AND r.deleted_at IS NULL)
                               AS reply_count
                    FROM discussion_threads AS t
                    JOIN users AS u ON u.user_id = t.author_user_id
                    WHERE t.thread_id = :thread_id AND t.deleted_at IS NULL
                    """
                ),
                {"thread_id": thread_id},
            ).one_or_none()
        if thread_row is None:
            raise ThreadNotFoundError
        thread = self._thread_from_row(thread_row)
        self._authorize_thread_scope(user_id, thread.scope)
        offset = (page_number - 1) * page_size
        with self.engine.connect() as connection:
            total = connection.execute(
                text(
                    """
                    SELECT COUNT(*) AS total
                    FROM discussion_replies
                    WHERE thread_id = :thread_id AND deleted_at IS NULL
                    """
                ),
                {"thread_id": thread_id},
            ).scalar_one()
            reply_rows = connection.execute(
                text(
                    """
                    SELECT r.reply_id, r.thread_id, r.body, r.author_user_id,
                           u.name AS author_name, r.created_at
                    FROM discussion_replies AS r
                    JOIN users AS u ON u.user_id = r.author_user_id
                    WHERE r.thread_id = :thread_id AND r.deleted_at IS NULL
                    ORDER BY r.created_at ASC, r.reply_id ASC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {"thread_id": thread_id, "limit": page_size, "offset": offset},
            ).all()
        replies = [self._reply_from_row(row) for row in reply_rows]
        total_pages = max(1, (total + page_size - 1) // page_size) if total else 0
        if total == 0:
            total_pages = 0
        return ThreadDetail(
            thread=thread,
            replies=ReplyPage(
                replies=replies,
                page_number=page_number,
                page_size=page_size,
                total_items=total,
                total_pages=total_pages,
            ),
        )

    def create_reply(
        self, user_id: int, thread_id: int, *, body: str
    ) -> ReplyRecord:
        body = (body or "").strip()
        if not body:
            raise DiscussionValidationError("Reply cannot be empty.")
        with self.engine.begin() as connection:
            thread_row = connection.execute(
                text(
                    """
                    SELECT scope
                    FROM discussion_threads
                    WHERE thread_id = :thread_id AND deleted_at IS NULL
                    FOR UPDATE
                    """
                ),
                {"thread_id": thread_id},
            ).one_or_none()
            if thread_row is None:
                raise ThreadNotFoundError
            self._authorize_thread_scope_on_connection(
                connection,
                user_id,
                thread_row.scope,
                write=True,
                lock_participation=True,
            )
            insert = connection.execute(
                text(
                    """
                    INSERT INTO discussion_replies
                        (thread_id, body, author_user_id)
                    VALUES
                        (:thread_id, :body, :author_user_id)
                    """
                ),
                {
                    "thread_id": thread_id,
                    "body": body,
                    "author_user_id": user_id,
                },
            )
            reply_id = insert.lastrowid
            row = connection.execute(
                text(
                    """
                    SELECT r.reply_id, r.thread_id, r.body, r.author_user_id,
                           u.name AS author_name, r.created_at
                    FROM discussion_replies AS r
                    JOIN users AS u ON u.user_id = r.author_user_id
                    WHERE r.reply_id = :reply_id
                    """
                ),
                {"reply_id": reply_id},
            ).one()
        logger.info(
            "Created discussion reply",
            extra={"reply_id": reply_id, "thread_id": thread_id, "user_id": user_id},
        )
        return self._reply_from_row(row)

    def _authorize_scope(
        self, user_id: int, scope: str, *, write: bool = False
    ) -> None:
        with self.engine.connect() as connection:
            self._authorize_scope_on_connection(
                connection, user_id, scope, write=write, lock_participation=False
            )

    def _authorize_thread_scope(
        self, user_id: int, scope: str, *, write: bool = False
    ) -> None:
        with self.engine.connect() as connection:
            self._authorize_thread_scope_on_connection(
                connection, user_id, scope, write=write, lock_participation=False
            )

    def _authorize_scope_on_connection(
        self,
        connection,
        user_id: int,
        scope: str,
        *,
        write: bool = False,
        lock_participation: bool = False,
    ) -> None:
        if scope == "grove":
            # Any signed-in user. Organizer/moderator roles are not required and do
            # not grant extra powers beyond membership of the campus Grove.
            return
        match = QUEST_SCOPE_PATTERN.match(scope)
        if not match:
            raise DiscussionValidationError(f"Unknown scope: {scope}")
        item_id = int(match.group(1))
        requested_space = match.group(2)
        self._authorize_quest_space_on_connection(
            connection,
            user_id,
            item_id,
            requested_space,
            write=write,
            lock_participation=lock_participation,
        )

    def _authorize_thread_scope_on_connection(
        self,
        connection,
        user_id: int,
        scope: str,
        *,
        write: bool = False,
        lock_participation: bool = False,
    ) -> None:
        if scope == "grove":
            return
        legacy = LEGACY_QUEST_SCOPE_PATTERN.match(scope)
        if legacy:
            # Historical unsuffixed rows are treated as submitted-only so spoilers
            # never re-enter the active space.
            item_id = int(legacy.group(1))
            self._authorize_quest_space_on_connection(
                connection,
                user_id,
                item_id,
                "submitted",
                write=write,
                lock_participation=lock_participation,
            )
            return
        match = QUEST_SCOPE_PATTERN.match(scope)
        if not match:
            raise DiscussionValidationError(f"Unknown scope: {scope}")
        item_id = int(match.group(1))
        requested_space = match.group(2)
        self._authorize_quest_space_on_connection(
            connection,
            user_id,
            item_id,
            requested_space,
            write=write,
            lock_participation=lock_participation,
        )

    def _authorize_quest_space(
        self,
        user_id: int,
        item_id: int,
        requested_space: str,
        *,
        write: bool = False,
    ) -> None:
        with self.engine.connect() as connection:
            self._authorize_quest_space_on_connection(
                connection,
                user_id,
                item_id,
                requested_space,
                write=write,
                lock_participation=False,
            )

    def _authorize_quest_space_on_connection(
        self,
        connection,
        user_id: int,
        item_id: int,
        requested_space: str,
        *,
        write: bool = False,
        lock_participation: bool = False,
    ) -> None:
        # No organizer/moderator bypass: quest spaces require the caller's own
        # participation phase (joined → active; confirmed proof → submitted).
        del write  # write uses the same membership rules as read
        self._require_published_quest_on_connection(connection, item_id)
        participation = self._load_participation_on_connection(
            connection, user_id, item_id, lock=lock_participation
        )
        if participation is None:
            raise NotAMemberError
        status, current_submission_id = participation
        allowed_space = _user_quest_space_value(status, current_submission_id)
        if allowed_space == "none":
            raise NotAMemberError
        if allowed_space != requested_space:
            raise ScopeAccessDeniedError

    def _require_published_quest(self, item_id: int) -> None:
        with self.engine.connect() as connection:
            self._require_published_quest_on_connection(connection, item_id)

    def _require_published_quest_on_connection(self, connection, item_id: int) -> None:
        row = connection.execute(
            text(
                """
                SELECT item_id, kind, status, archived_at
                FROM catalogue_items
                WHERE item_id = :item_id
                """
            ),
            {"item_id": item_id},
        ).one_or_none()
        if row is None:
            raise ItemNotFoundError
        if row.kind != ItemKind.QUEST.value:
            raise ItemNotFoundError
        if row.status != ItemStatus.PUBLISHED.value or row.archived_at is not None:
            raise ItemNotFoundError

    def _load_participation(
        self, user_id: int, item_id: int
    ) -> tuple[str, int | None] | None:
        with self.engine.connect() as connection:
            return self._load_participation_on_connection(
                connection, user_id, item_id, lock=False
            )

    def _load_participation_on_connection(
        self, connection, user_id: int, item_id: int, *, lock: bool
    ) -> tuple[str, int | None] | None:
        lock_sql = " FOR UPDATE" if lock else ""
        row = connection.execute(
            text(
                f"""
                SELECT status, current_submission_id
                FROM participations
                WHERE user_id = :user_id AND item_id = :item_id
                {lock_sql}
                """
            ),
            {"user_id": user_id, "item_id": item_id},
        ).one_or_none()
        if row is None:
            return None
        return row.status, row.current_submission_id

    def _item_id_for_scope(self, scope: str) -> int | None:
        match = QUEST_SCOPE_PATTERN.match(scope)
        if match:
            return int(match.group(1))
        return None

    def _thread_from_row(self, row) -> ThreadRecord:
        return ThreadRecord(
            thread_id=row.thread_id,
            scope=row.scope,
            title=row.title,
            category=row.category,
            body=row.body,
            author=DiscussionAuthor(user_id=row.author_user_id, name=row.author_name),
            created_at=from_utc_naive(row.created_at),
            reply_count=row.reply_count,
        )

    def _reply_from_row(self, row) -> ReplyRecord:
        return ReplyRecord(
            reply_id=row.reply_id,
            thread_id=row.thread_id,
            body=row.body,
            author=DiscussionAuthor(user_id=row.author_user_id, name=row.author_name),
            created_at=from_utc_naive(row.created_at),
        )