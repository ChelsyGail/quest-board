from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from datetime import timedelta
from datetime import timezone

import jwt
from services.user_service import UserRecord
from services.user_service import UserService
from utilities.settings import AuthSettings

logger = logging.getLogger(__name__)


class InvalidCredentialsError(Exception):
    pass


class InvalidTokenError(Exception):
    pass


@dataclass(frozen=True)
class AccessToken:
    token: str
    expires_at: datetime


@dataclass(frozen=True)
class TokenSubject:
    user_id: int


class AuthService:
    def __init__(self, settings: AuthSettings, user_service: UserService):
        self.settings = settings
        self.user_service = user_service

    def authenticate(self, email: str, password: str) -> UserRecord:
        credentials = self.user_service.get_credentials_by_email(email)
        if credentials is None or not self.user_service.verify_password(
            password, credentials.password_hash
        ):
            logger.warning("Login failed", extra={"email": email})
            raise InvalidCredentialsError

        logger.info("Login succeeded", extra={"user_id": credentials.record.user_id})
        return credentials.record

    def create_access_token(self, user: UserRecord) -> AccessToken:
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=self.settings.access_token_expires_minutes
        )
        payload = {"sub": str(user.user_id), "exp": expires_at}
        token = jwt.encode(
            payload, self.settings.secret_key, algorithm=self.settings.algorithm
        )
        logger.info("Issued access token", extra={"user_id": user.user_id})
        return AccessToken(token=token, expires_at=expires_at)

    def decode_access_token(self, token: str) -> TokenSubject:
        try:
            payload = jwt.decode(
                token, self.settings.secret_key, algorithms=[self.settings.algorithm]
            )
        except jwt.PyJWTError as error:
            logger.warning("Rejected invalid or expired access token")
            raise InvalidTokenError from error

        return TokenSubject(user_id=int(payload["sub"]))
