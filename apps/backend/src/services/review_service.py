from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.catalogue import ParticipationStatus
from models.proof import SubmissionStatus
from models.users import UserRole
from services.catalogue_service import from_utc_naive
from services.catalogue_service import item_record_from_row
from services.catalogue_service import ItemRecord
from services.proof_service import load_submission
from services.proof_service import SubmissionNotFoundError
from services.proof_service import SubmissionRecord
from services.recognition_service import award_points
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from utilities.settings import DatabaseSettings
from utilities.transactions import with_deadlock_retry

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


class NotAModeratorError(Exception):
    """The reviewer lost the moderator role between sign-in and the decision."""


class SelfReviewError(Exception):
    """A moderator cannot decide their own attempt (BE-48)."""


class SubmissionNotPendingError(Exception):
    """The attempt is not the one awaiting review: already decided, or replaced."""


class SubmissionAlreadyReviewedError(Exception):
    """The attempt already has its one final review (BE-49)."""


@dataclass(frozen=True)
class ReviewRecord:
    review_id: int
    submission_id: int
    participation_id: int
    reviewer_id: int
    decision: SubmissionStatus
    feedback: str | None
    reviewed_at: datetime
    points_awarded: int | None = None


@dataclass(frozen=True)
class SubmissionDetail:
    submission: SubmissionRecord
    item: ItemRecord
    student_name: str


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

    def get_submission(self, submission_id: int) -> SubmissionDetail:
        """BE-45: the attempt, the quest it is for and who sent it. Raises
        SubmissionNotFoundError for an unknown id."""
        with self.engine.connect() as connection:
            submission = load_submission(connection, submission_id)
            item_row = connection.execute(
                text("SELECT * FROM catalogue_items WHERE item_id = :item_id"),
                {"item_id": submission.item_id},
            ).one()
            student_name = connection.execute(
                text("SELECT name FROM users WHERE user_id = :user_id"),
                {"user_id": submission.user_id},
            ).scalar_one()
        return SubmissionDetail(
            submission=submission,
            item=item_record_from_row(item_row),
            student_name=student_name,
        )

    def approve(self, submission_id: int, reviewer_id: int) -> ReviewRecord:
        """BE-46: the review, the Approved status and the point award commit in
        one transaction, so credit is never half-applied. Retried a bounded
        number of times if InnoDB picks it as a deadlock victim."""
        logger.info(
            "Approving submission",
            extra={"submission_id": submission_id, "reviewer_id": reviewer_id},
        )
        return with_deadlock_retry(
            lambda: self._decide(submission_id, reviewer_id, SubmissionStatus.APPROVED)
        )

    def reject(
        self, submission_id: int, reviewer_id: int, feedback: str
    ) -> ReviewRecord:
        """BE-47: saves a Rejected review with the moderator's feedback and sets
        the participation to Rejected. Nothing is awarded; the student may send
        a new attempt (BE-41)."""
        logger.info(
            "Rejecting submission",
            extra={"submission_id": submission_id, "reviewer_id": reviewer_id},
        )
        return with_deadlock_retry(
            lambda: self._decide(
                submission_id, reviewer_id, SubmissionStatus.REJECTED, feedback
            )
        )

    def _decide(
        self,
        submission_id: int,
        reviewer_id: int,
        decision: SubmissionStatus,
        feedback: str | None = None,
    ) -> ReviewRecord:
        with self.engine.begin() as connection:
            participation = self._lock_attempt(connection, submission_id)
            self._require_moderator(connection, reviewer_id)
            if participation.user_id == reviewer_id:
                logger.warning(
                    "Self-review refused",
                    extra={"submission_id": submission_id, "reviewer_id": reviewer_id},
                )
                raise SelfReviewError
            if self._find_review(connection, submission_id) is not None:
                raise SubmissionAlreadyReviewedError
            if (
                participation.status != ParticipationStatus.PENDING.value
                or participation.current_submission_id != submission_id
            ):
                raise SubmissionNotPendingError

            review_id = self._insert_review(
                connection,
                submission_id,
                participation.participation_id,
                reviewer_id,
                decision,
                feedback,
            )
            connection.execute(
                text(
                    "UPDATE participations SET status = :status "
                    "WHERE participation_id = :participation_id"
                ),
                {
                    "status": decision.value,
                    "participation_id": participation.participation_id,
                },
            )
            points_awarded = None
            if decision == SubmissionStatus.APPROVED:
                points_awarded = award_points(
                    connection, participation.participation_id
                ).points
            row = connection.execute(
                text("SELECT * FROM reviews WHERE review_id = :review_id"),
                {"review_id": review_id},
            ).one()

        logger.info(
            "Recorded review",
            extra={
                "review_id": review_id,
                "submission_id": submission_id,
                "decision": decision.value,
            },
        )
        return _to_review(row, points_awarded)

    @staticmethod
    def _find_review(connection, submission_id: int):
        return connection.execute(
            text("SELECT * FROM reviews WHERE submission_id = :submission_id"),
            {"submission_id": submission_id},
        ).one_or_none()

    @staticmethod
    def _insert_review(
        connection,
        submission_id: int,
        participation_id: int,
        reviewer_id: int,
        decision: SubmissionStatus,
        feedback: str | None,
    ) -> int:
        """unique_reviews_submission (BE-49) is the final guard: if a second
        review slips past the checks above, the insert fails and the whole
        decision rolls back."""
        try:
            result = connection.execute(
                text(
                    """
                    INSERT INTO reviews
                        (submission_id, participation_id, reviewer_id, decision,
                         feedback)
                    VALUES
                        (:submission_id, :participation_id, :reviewer_id, :decision,
                         :feedback)
                    """
                ),
                {
                    "submission_id": submission_id,
                    "participation_id": participation_id,
                    "reviewer_id": reviewer_id,
                    "decision": decision.value,
                    "feedback": feedback,
                },
            )
        except IntegrityError as error:
            logger.warning(
                "Second review refused by the database",
                extra={"submission_id": submission_id, "reviewer_id": reviewer_id},
            )
            raise SubmissionAlreadyReviewedError from error
        return result.lastrowid

    @staticmethod
    def _lock_attempt(connection, submission_id: int):
        """Locks, in this order, the participation, the submission and the
        student's user row. Every transaction that touches a student's
        recognition takes the user row last (claims take only that one), so the
        order is always the same and two reviews cannot deadlock each other."""
        participation_id = connection.execute(
            text(
                "SELECT participation_id FROM submissions "
                "WHERE submission_id = :submission_id"
            ),
            {"submission_id": submission_id},
        ).scalar_one_or_none()
        if participation_id is None:
            raise SubmissionNotFoundError
        participation = connection.execute(
            text(
                """
                SELECT participation_id, user_id, item_id, status,
                       current_submission_id
                FROM participations
                WHERE participation_id = :participation_id
                FOR UPDATE
                """
            ),
            {"participation_id": participation_id},
        ).one()
        connection.execute(
            text(
                "SELECT submission_id FROM submissions "
                "WHERE submission_id = :submission_id FOR UPDATE"
            ),
            {"submission_id": submission_id},
        )
        connection.execute(
            text("SELECT user_id FROM users WHERE user_id = :user_id FOR UPDATE"),
            {"user_id": participation.user_id},
        )
        return participation

    @staticmethod
    def _require_moderator(connection, reviewer_id: int) -> None:
        """The token was checked on the way in; this rechecks the role inside the
        transaction, so a moderator removed a moment ago cannot still decide."""
        roles = connection.execute(
            text("SELECT roles FROM users WHERE user_id = :user_id"),
            {"user_id": reviewer_id},
        ).scalar_one_or_none()
        if roles is None:
            raise NotAModeratorError
        granted = roles if isinstance(roles, (set, frozenset)) else roles.split(",")
        if UserRole.MODERATOR.value not in granted:
            raise NotAModeratorError


def _to_review(row, points_awarded: int | None) -> ReviewRecord:
    return ReviewRecord(
        review_id=row.review_id,
        submission_id=row.submission_id,
        participation_id=row.participation_id,
        reviewer_id=row.reviewer_id,
        decision=SubmissionStatus(row.decision),
        feedback=row.feedback,
        reviewed_at=from_utc_naive(row.created_at),
        points_awarded=points_awarded,
    )
