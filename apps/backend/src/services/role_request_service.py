from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.role_requests import RoleRequestCreate
from models.role_requests import RoleRequestStatus
from models.users import UserRole
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


class RoleRequestNotFoundError(Exception):
    pass


class RoleAlreadyHeldError(Exception):
    pass


class DuplicatePendingRoleRequestError(Exception):
    pass


class RoleRequestAlreadyReviewedError(Exception):
    pass


class SelfReviewError(Exception):
    pass


@dataclass(frozen=True)
class RoleRequestRecord:
    role_request_id: int
    user_id: int
    role: UserRole
    reason: str | None
    status: RoleRequestStatus
    reviewed_by: int | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime


SELECT_COLUMNS = """
    SELECT role_request_id, user_id, requested_role, reason, status,
           reviewed_by, reviewed_at, created_at, updated_at
    FROM role_requests
"""


class RoleRequestService:
    def __init__(self, settings: DatabaseSettings):
        self.engine = create_database_engine(settings)

    def create_request(
        self,
        user_id: int,
        current_roles: frozenset[UserRole],
        request: RoleRequestCreate,
    ) -> RoleRequestRecord:
        if request.role in current_roles:
            raise RoleAlreadyHeldError

        logger.info(
            "Creating role request",
            extra={"user_id": user_id, "role": request.role.value},
        )
        try:
            with self.engine.begin() as connection:
                result = connection.execute(
                    text(
                        """
                        INSERT INTO role_requests (user_id, requested_role, reason)
                        VALUES (:user_id, :role, :reason)
                        """
                    ),
                    {
                        "user_id": user_id,
                        "role": request.role.value,
                        "reason": request.reason,
                    },
                )
                row = self._load_request(connection, result.lastrowid)
        except IntegrityError as error:
            # The unique key on (user_id, pending_role) blocks a second pending request.
            logger.warning(
                "Pending role request already exists",
                extra={"user_id": user_id, "role": request.role.value},
            )
            raise DuplicatePendingRoleRequestError from error

        return self._to_record(row)

    def list_requests(
        self,
        status: RoleRequestStatus | None = None,
        user_id: int | None = None,
    ) -> list[RoleRequestRecord]:
        conditions = []
        parameters = {}
        if status is not None:
            conditions.append("status = :status")
            parameters["status"] = status.value
        if user_id is not None:
            conditions.append("user_id = :user_id")
            parameters["user_id"] = user_id
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        with self.engine.connect() as connection:
            rows = connection.execute(
                text(f"{SELECT_COLUMNS} {where} ORDER BY created_at, role_request_id"),
                parameters,
            ).all()
        return [self._to_record(row) for row in rows]

    def approve_request(
        self, role_request_id: int, reviewer_id: int
    ) -> RoleRequestRecord:
        return self._review(role_request_id, reviewer_id, RoleRequestStatus.APPROVED)

    def reject_request(
        self, role_request_id: int, reviewer_id: int
    ) -> RoleRequestRecord:
        return self._review(role_request_id, reviewer_id, RoleRequestStatus.REJECTED)

    def _review(
        self,
        role_request_id: int,
        reviewer_id: int,
        decision: RoleRequestStatus,
    ) -> RoleRequestRecord:
        logger.info(
            "Reviewing role request",
            extra={
                "role_request_id": role_request_id,
                "reviewer_id": reviewer_id,
                "decision": decision.value,
            },
        )
        with self.engine.begin() as connection:
            # Lock the row so two admins can't review the same request at once.
            row = connection.execute(
                text(f"{SELECT_COLUMNS} WHERE role_request_id = :id FOR UPDATE"),
                {"id": role_request_id},
            ).one_or_none()
            if row is None:
                raise RoleRequestNotFoundError
            if row.status != RoleRequestStatus.PENDING:
                raise RoleRequestAlreadyReviewedError
            if row.user_id == reviewer_id:
                raise SelfReviewError

            connection.execute(
                text(
                    """
                    UPDATE role_requests
                    SET status = :status,
                        reviewed_by = :reviewer_id,
                        reviewed_at = CURRENT_TIMESTAMP(6)
                    WHERE role_request_id = :id
                    """
                ),
                {
                    "status": decision.value,
                    "reviewer_id": reviewer_id,
                    "id": role_request_id,
                },
            )

            if decision == RoleRequestStatus.APPROVED:
                # Adding a member a SET column already has is a no-op in MySQL.
                connection.execute(
                    text(
                        """
                        UPDATE users
                        SET roles = CONCAT_WS(',', roles, :role),
                            updated_at = CURRENT_TIMESTAMP(6)
                        WHERE user_id = :user_id AND deleted_at IS NULL
                        """
                    ),
                    {"role": row.requested_role, "user_id": row.user_id},
                )

            row = self._load_request(connection, role_request_id)

        logger.info(
            "Reviewed role request",
            extra={"role_request_id": role_request_id, "decision": decision.value},
        )
        return self._to_record(row)

    @staticmethod
    def _load_request(connection, role_request_id: int):
        return connection.execute(
            text(f"{SELECT_COLUMNS} WHERE role_request_id = :id"),
            {"id": role_request_id},
        ).one()

    @staticmethod
    def _to_record(row) -> RoleRequestRecord:
        return RoleRequestRecord(
            role_request_id=row.role_request_id,
            user_id=row.user_id,
            role=UserRole(row.requested_role),
            reason=row.reason,
            status=RoleRequestStatus(row.status),
            reviewed_by=row.reviewed_by,
            reviewed_at=row.reviewed_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
