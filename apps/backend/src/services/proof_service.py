from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.catalogue import ItemKind
from models.proof import SubmissionCreate
from models.proof import SubmissionStatus
from services.catalogue_service import from_utc_naive
from sqlalchemy import bindparam
from sqlalchemy import text
from utilities.media_types import ALLOWED_MEDIA_TYPES
from utilities.media_types import content_matches
from utilities.media_types import MAX_BYTES
from utilities.media_types import MediaKind
from utilities.object_store import ObjectStore
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


class ParticipationNotFoundError(Exception):
    pass


class NotYourParticipationError(Exception):
    """Proof can only be submitted on, or read from, the student's own attempt."""


class ProofNotAcceptedError(Exception):
    """Only quests take proof; an event RSVP has nothing to prove."""


class EmptySubmissionError(Exception):
    """An attempt needs at least some text or one file."""


class UnsupportedMediaTypeError(Exception):
    pass


class MediaTooLargeError(Exception):
    def __init__(self, limit_bytes: int):
        super().__init__(limit_bytes)
        self.limit_bytes = limit_bytes


class EmptyUploadError(Exception):
    pass


class MediaContentMismatchError(Exception):
    """The bytes do not look like the type the client declared."""


class MediaNotUsableError(Exception):
    """A media id in a submission is unknown, someone else's, or already attached
    to an attempt. `index` is its position in media_ids, for the error pointer."""

    def __init__(self, index: int):
        super().__init__(index)
        self.index = index


@dataclass(frozen=True)
class MediaRecord:
    media_id: int
    owner_id: int
    submission_id: int | None
    content_type: str
    kind: MediaKind
    size_bytes: int
    object_key: str
    uploaded_at: datetime


@dataclass(frozen=True)
class SubmissionRecord:
    submission_id: int
    participation_id: int
    item_id: int
    user_id: int
    attempt_number: int
    text: str | None
    media: list[MediaRecord]
    status: SubmissionStatus
    submitted_at: datetime


SELECT_MEDIA_COLUMNS = """
    SELECT media_id, owner_id, submission_id, content_type, media_kind,
           size_bytes, object_key, created_at
    FROM submission_media
"""

SELECT_SUBMISSION_COLUMNS = """
    SELECT s.submission_id, s.participation_id, s.attempt_number, s.text_proof,
           s.created_at, p.item_id, p.user_id
    FROM submissions AS s
    JOIN participations AS p ON p.participation_id = s.participation_id
"""


class ProofService:
    """Proof submission (C3 "Proof and Review", the student side)."""

    def __init__(self, settings: DatabaseSettings, object_store: ObjectStore):
        self.engine = create_database_engine(settings)
        self.object_store = object_store

    def store_upload(
        self, owner_id: int, content_type: str, data: bytes
    ) -> MediaRecord:
        """Checks type and size, writes the bytes to private storage, and records
        an unattached upload the student can then reference in a submission."""
        media_type = ALLOWED_MEDIA_TYPES.get(content_type)
        if media_type is None:
            raise UnsupportedMediaTypeError
        if not data:
            raise EmptyUploadError
        limit = MAX_BYTES[media_type.kind]
        if len(data) > limit:
            raise MediaTooLargeError(limit)
        if not content_matches(content_type, data):
            logger.warning(
                "Upload content does not match its declared type",
                extra={"owner_id": owner_id, "content_type": content_type},
            )
            raise MediaContentMismatchError

        object_key = f"proof/{owner_id}/{uuid.uuid4().hex}"
        self.object_store.put(object_key, data)
        try:
            with self.engine.begin() as connection:
                result = connection.execute(
                    text(
                        """
                        INSERT INTO submission_media (
                            owner_id, content_type, media_kind, size_bytes, object_key
                        )
                        VALUES (
                            :owner_id, :content_type, :media_kind, :size_bytes,
                            :object_key
                        )
                        """
                    ),
                    {
                        "owner_id": owner_id,
                        "content_type": content_type,
                        "media_kind": media_type.kind.value,
                        "size_bytes": len(data),
                        "object_key": object_key,
                    },
                )
                row = connection.execute(
                    text(f"{SELECT_MEDIA_COLUMNS} WHERE media_id = :media_id"),
                    {"media_id": result.lastrowid},
                ).one()
        except Exception:
            # The bytes are useless without their row; do not leave them behind.
            self.object_store.delete(object_key)
            raise

        logger.info(
            "Stored proof upload",
            extra={"media_id": row.media_id, "size_bytes": len(data)},
        )
        return self._to_media(row)

    def submit(
        self, user_id: int, participation_id: int, submission: SubmissionCreate
    ) -> SubmissionRecord:
        """Adds a new attempt to the student's own participation in a quest."""
        logger.info(
            "Submitting proof",
            extra={"user_id": user_id, "participation_id": participation_id},
        )
        with self.engine.begin() as connection:
            participation = self._lock_own_quest_participation(
                connection, user_id, participation_id
            )
            if submission.text is None and not submission.media_ids:
                raise EmptySubmissionError
            self._lock_attachable_media(connection, user_id, submission.media_ids)
            attempt_number = self._next_attempt_number(connection, participation_id)
            result = connection.execute(
                text(
                    """
                    INSERT INTO submissions
                        (participation_id, attempt_number, text_proof)
                    VALUES (:participation_id, :attempt_number, :text_proof)
                    """
                ),
                {
                    "participation_id": participation_id,
                    "attempt_number": attempt_number,
                    "text_proof": submission.text,
                },
            )
            submission_id = result.lastrowid
            if submission.media_ids:
                connection.execute(
                    text(
                        """
                        UPDATE submission_media
                        SET submission_id = :submission_id,
                            attached_at = CURRENT_TIMESTAMP(6)
                        WHERE media_id IN :media_ids
                        """
                    ).bindparams(bindparam("media_ids", expanding=True)),
                    {"submission_id": submission_id, "media_ids": submission.media_ids},
                )
            connection.execute(
                text(
                    """
                    UPDATE participations
                    SET current_submission_id = :submission_id
                    WHERE participation_id = :participation_id
                    """
                ),
                {
                    "submission_id": submission_id,
                    "participation_id": participation.participation_id,
                },
            )
            record = self._load_submission(connection, submission_id)

        logger.info(
            "Submitted proof",
            extra={
                "submission_id": record.submission_id,
                "attempt_number": record.attempt_number,
            },
        )
        return record

    def list_submissions(
        self, user_id: int, participation_id: int
    ) -> list[SubmissionRecord]:
        """Every attempt on the student's own participation, oldest first."""
        with self.engine.connect() as connection:
            owner_id = connection.execute(
                text(
                    "SELECT user_id FROM participations "
                    "WHERE participation_id = :participation_id"
                ),
                {"participation_id": participation_id},
            ).scalar_one_or_none()
            if owner_id is None:
                raise ParticipationNotFoundError
            if owner_id != user_id:
                raise NotYourParticipationError
            rows = connection.execute(
                text(
                    f"""{SELECT_SUBMISSION_COLUMNS}
                    WHERE s.participation_id = :participation_id
                    ORDER BY s.attempt_number
                    """
                ),
                {"participation_id": participation_id},
            ).all()
            return [self._to_record(connection, row) for row in rows]

    @staticmethod
    def _lock_own_quest_participation(connection, user_id: int, participation_id: int):
        """Locks the participation so two submissions cannot pick the same attempt
        number, and checks it belongs to this student and to a quest."""
        row = connection.execute(
            text(
                """
                SELECT p.participation_id, p.user_id, p.item_id, p.status, i.kind
                FROM participations AS p
                JOIN catalogue_items AS i ON i.item_id = p.item_id
                WHERE p.participation_id = :participation_id
                FOR UPDATE OF p
                """
            ),
            {"participation_id": participation_id},
        ).one_or_none()
        if row is None:
            raise ParticipationNotFoundError
        if row.user_id != user_id:
            logger.warning(
                "Proof refused on another student's participation",
                extra={"user_id": user_id, "participation_id": participation_id},
            )
            raise NotYourParticipationError
        if row.kind != ItemKind.QUEST.value:
            raise ProofNotAcceptedError
        return row

    @staticmethod
    def _lock_attachable_media(connection, user_id: int, media_ids: list[int]) -> None:
        """Every referenced upload must be this student's and not yet attached.
        Locking the rows stops one upload landing on two attempts at once."""
        if not media_ids:
            return
        rows = connection.execute(
            text(
                """
                SELECT media_id, owner_id, submission_id
                FROM submission_media
                WHERE media_id IN :media_ids
                FOR UPDATE
                """
            ).bindparams(bindparam("media_ids", expanding=True)),
            {"media_ids": media_ids},
        ).all()
        usable = {
            row.media_id
            for row in rows
            if row.owner_id == user_id and row.submission_id is None
        }
        for index, media_id in enumerate(media_ids):
            if media_id not in usable:
                raise MediaNotUsableError(index)

    @staticmethod
    def _next_attempt_number(connection, participation_id: int) -> int:
        return connection.execute(
            text(
                "SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM submissions "
                "WHERE participation_id = :participation_id"
            ),
            {"participation_id": participation_id},
        ).scalar_one()

    def _load_submission(self, connection, submission_id: int) -> SubmissionRecord:
        row = connection.execute(
            text(f"{SELECT_SUBMISSION_COLUMNS} WHERE s.submission_id = :submission_id"),
            {"submission_id": submission_id},
        ).one()
        return self._to_record(connection, row)

    def _to_record(self, connection, row) -> SubmissionRecord:
        media_rows = connection.execute(
            text(
                f"""{SELECT_MEDIA_COLUMNS}
                WHERE submission_id = :submission_id
                ORDER BY media_id
                """
            ),
            {"submission_id": row.submission_id},
        ).all()
        return SubmissionRecord(
            submission_id=row.submission_id,
            participation_id=row.participation_id,
            item_id=row.item_id,
            user_id=row.user_id,
            attempt_number=row.attempt_number,
            text=row.text_proof,
            media=[self._to_media(media_row) for media_row in media_rows],
            status=SubmissionStatus.PENDING,
            submitted_at=from_utc_naive(row.created_at),
        )

    @staticmethod
    def _to_media(row) -> MediaRecord:
        return MediaRecord(
            media_id=row.media_id,
            owner_id=row.owner_id,
            submission_id=row.submission_id,
            content_type=row.content_type,
            kind=MediaKind(row.media_kind),
            size_bytes=row.size_bytes,
            object_key=row.object_key,
            uploaded_at=from_utc_naive(row.created_at),
        )
