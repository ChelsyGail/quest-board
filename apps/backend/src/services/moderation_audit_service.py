"""Moderation audit log (BE-52): who decided what, about which attempt, when.

record_decision takes the caller's connection because it runs inside the
approval or rejection transaction: the review and its audit row commit
together or not at all. There is deliberately no update or delete here.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.proof import SubmissionStatus
from services.catalogue_service import from_utc_naive
from sqlalchemy import text
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuditEntry:
    audit_id: int
    review_id: int
    submission_id: int
    participation_id: int
    student_id: int
    student_name: str
    reviewer_id: int
    reviewer_name: str
    decision: SubmissionStatus
    feedback: str | None
    points_awarded: int | None
    decided_at: datetime


@dataclass(frozen=True)
class AuditFilters:
    submission_id: int | None = None
    reviewer_id: int | None = None
    student_id: int | None = None


@dataclass(frozen=True)
class AuditPage:
    entries: list[AuditEntry]
    page_number: int
    page_size: int
    total_items: int

    @property
    def total_pages(self) -> int:
        return -(-self.total_items // self.page_size)


def record_decision(
    connection,
    review_id: int,
    student_id: int,
    points_awarded: int | None,
) -> None:
    """Copies the review just inserted on this connection into the log. The
    copy keeps the decision readable even if the review row is ever changed
    by hand."""
    connection.execute(
        text(
            """
            INSERT INTO moderation_audit_log
                (review_id, submission_id, participation_id, student_id,
                 reviewer_id, decision, feedback, points_awarded, created_at)
            SELECT review_id, submission_id, participation_id, :student_id,
                   reviewer_id, decision, feedback, :points_awarded, created_at
            FROM reviews
            WHERE review_id = :review_id
            """
        ),
        {
            "review_id": review_id,
            "student_id": student_id,
            "points_awarded": points_awarded,
        },
    )


SELECT_ENTRIES = """
    SELECT a.*, s.name AS student_name, m.name AS reviewer_name
    FROM moderation_audit_log AS a
    JOIN users AS s ON s.user_id = a.student_id
    JOIN users AS m ON m.user_id = a.reviewer_id
"""


def _filter_clause(filters: AuditFilters) -> tuple[str, dict]:
    clauses = []
    parameters = {}
    for field in ("submission_id", "reviewer_id", "student_id"):
        value = getattr(filters, field)
        if value is not None:
            clauses.append(f"a.{field} = :{field}")
            parameters[field] = value
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, parameters


class ModerationAuditService:
    def __init__(self, settings: DatabaseSettings):
        self.engine = create_database_engine(settings)

    def list_entries(
        self, filters: AuditFilters, page_number: int, page_size: int
    ) -> AuditPage:
        """Newest decision first, ties broken by id so pages never overlap."""
        where, parameters = _filter_clause(filters)
        with self.engine.connect() as connection:
            total_items = connection.execute(
                text("SELECT COUNT(*) FROM moderation_audit_log AS a" + where),
                parameters,
            ).scalar_one()
            rows = connection.execute(
                text(
                    SELECT_ENTRIES
                    + where
                    + " ORDER BY a.created_at DESC, a.audit_id DESC"
                    + " LIMIT :limit OFFSET :offset"
                ),
                {
                    **parameters,
                    "limit": page_size,
                    "offset": (page_number - 1) * page_size,
                },
            ).all()
        return AuditPage(
            entries=[_to_entry(row) for row in rows],
            page_number=page_number,
            page_size=page_size,
            total_items=total_items,
        )


def _to_entry(row) -> AuditEntry:
    return AuditEntry(
        audit_id=row.audit_id,
        review_id=row.review_id,
        submission_id=row.submission_id,
        participation_id=row.participation_id,
        student_id=row.student_id,
        student_name=row.student_name,
        reviewer_id=row.reviewer_id,
        reviewer_name=row.reviewer_name,
        decision=SubmissionStatus(row.decision),
        feedback=row.feedback,
        points_awarded=row.points_awarded,
        decided_at=from_utc_naive(row.created_at),
    )
