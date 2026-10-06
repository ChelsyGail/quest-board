from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.users import UserCreate
from models.users import UserRole
from models.users import UserUpdate
from pwdlib import PasswordHash
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


class UserNotFoundError(Exception):
    pass


class DuplicateUserEmailError(Exception):
    pass


@dataclass(frozen=True)
class UserRecord:
    user_id: int
    email: str
    name: str
    roles: tuple[UserRole, ...]
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class UserCredentials:
    record: UserRecord
    password_hash: str


class UserService:
    def __init__(self, settings: DatabaseSettings):
        self.engine = create_database_engine(settings)
        self.password_hash = PasswordHash.recommended()

    def create_user(self, user: UserCreate) -> UserRecord:
        logger.info("Creating user", extra={"email": str(user.email)})
        password_hash = self.password_hash.hash(user.password)
        # roles = self._serialize_roles(user.roles)

        try:
            with self.engine.begin() as connection:
                result = connection.execute(
                    text(
                        """
                        INSERT INTO users (email, name, password_hash)
                        VALUES (:email, :name, :password_hash)
                        """
                    ),
                    {
                        "email": str(user.email),
                        "name": user.name,
                        "password_hash": password_hash,
                        # "roles": roles,
                    },
                )
                user_id = result.lastrowid
                row = self._load_user(connection, user_id)
        except IntegrityError as error:
            logger.warning(
                "User email already exists", extra={"email": str(user.email)}
            )
            raise DuplicateUserEmailError from error
        except Exception:
            logger.exception("Failed to create user", extra={"email": str(user.email)})
            raise

        logger.info("Created user", extra={"user_id": user_id})
        return self._to_record(row)

    def update_user(self, user_id: int, update: UserUpdate) -> UserRecord:
        changes = update.model_dump(exclude_unset=True)
        if "email" in changes:
            changes["email"] = str(changes["email"])
        if "password" in changes:
            changes["password_hash"] = self.password_hash.hash(changes.pop("password"))
        # if "roles" in changes:
        #   changes["roles"] = self._serialize_roles(changes["roles"])

        assignments = [f"{field} = :{field}" for field in changes]
        assignments.append("updated_at = CURRENT_TIMESTAMP(6)")
        parameters = {**changes, "user_id": user_id}
        logger.info(
            "Updating user", extra={"user_id": user_id, "fields": sorted(changes)}
        )

        try:
            with self.engine.begin() as connection:
                result = connection.execute(
                    text(
                        f"""
                        UPDATE users
                        SET {", ".join(assignments)}
                        WHERE user_id = :user_id AND deleted_at IS NULL
                        """
                    ),
                    parameters,
                )
                if result.rowcount == 0:
                    raise UserNotFoundError
                row = self._load_user(connection, user_id)
        except IntegrityError as error:
            logger.warning("Updated email already exists", extra={"user_id": user_id})
            raise DuplicateUserEmailError from error
        except UserNotFoundError:
            logger.info("User not found for update", extra={"user_id": user_id})
            raise
        except Exception:
            logger.exception("Failed to update user", extra={"user_id": user_id})
            raise

        logger.info("Updated user", extra={"user_id": user_id})
        return self._to_record(row)

    def get_user(self, user_id: int) -> UserRecord:
        with self.engine.connect() as connection:
            row = self._find_user(connection, user_id)
        if row is None:
            raise UserNotFoundError
        return self._to_record(row)

    def get_credentials_by_email(self, email: str) -> UserCredentials | None:
        with self.engine.connect() as connection:
            row = connection.execute(
                text(
                    """
                    SELECT user_id, email, name, password_hash, roles, created_at, updated_at
                    FROM users
                    WHERE email = :email AND deleted_at IS NULL
                    """
                ),
                {"email": email},
            ).one_or_none()
        if row is None:
            return None
        return UserCredentials(
            record=self._to_record(row), password_hash=row.password_hash
        )

    def verify_password(self, password: str, password_hash: str) -> bool:
        return self.password_hash.verify(password, password_hash)

    @staticmethod
    def _find_user(connection, user_id: int):
        return connection.execute(
            text(
                """
                SELECT user_id, email, name, roles, created_at, updated_at
                FROM users
                WHERE user_id = :user_id AND deleted_at IS NULL
                """
            ),
            {"user_id": user_id},
        ).one_or_none()

    @staticmethod
    def _load_user(connection, user_id: int):
        return connection.execute(
            text(
                """
                SELECT user_id, email, name, roles, created_at, updated_at
                FROM users
                WHERE user_id = :user_id AND deleted_at IS NULL
                """
            ),
            {"user_id": user_id},
        ).one()

    @staticmethod
    def _serialize_roles(roles: set[UserRole]) -> str:
        return ",".join(sorted(role.value for role in roles))

    @staticmethod
    def _to_record(row) -> UserRecord:
        return UserRecord(
            user_id=row.user_id,
            email=row.email,
            name=row.name,
            roles=tuple(UserRole(role) for role in row.roles.split(",")),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
