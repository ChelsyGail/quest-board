from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Depends
from fastapi import HTTPException
from fastapi import status
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.security import HTTPBearer
from models.users import UserRole
from services.auth_service import AuthService
from services.auth_service import InvalidTokenError
from services.user_service import UserNotFoundError

logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    user_id: int
    roles: frozenset[UserRole]

    def has_role(self, *roles: UserRole) -> bool:
        return bool(self.roles.intersection(roles))


def build_current_user_dependency(auth_service: AuthService):
    """Binds the dependency to one AuthService instance, tracking the caller for this request."""

    def get_current_user(
        credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    ) -> CurrentUser:
        if credentials is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
            )

        try:
            subject = auth_service.decode_access_token(credentials.credentials)
        except InvalidTokenError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )

        try:
            user = auth_service.user_service.get_user(subject.user_id)
        except UserNotFoundError:
            logger.warning(
                "Token subject no longer exists", extra={"user_id": subject.user_id}
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )

        return CurrentUser(user_id=user.user_id, roles=frozenset(user.roles))

    return get_current_user


def require_roles(get_current_user, *roles: UserRole):
    """Wraps get_current_user with a role check for endpoints that need elevated access."""

    def check(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not current_user.has_role(*roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role"
            )
        return current_user

    return check
