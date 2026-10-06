import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Path
from fastapi import status
from models.responses.users import UserErrorResponse
from models.responses.users import UserResponse
from models.users import UserAttributes
from models.users import UserCreate
from models.users import UserResourceData
from models.users import UserRole
from models.users import UserUpdate
from services.user_service import DuplicateUserEmailError
from services.user_service import UserNotFoundError
from services.user_service import UserRecord
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)


def setup_user_router(app: FastAPI, services: Services):
    router = APIRouter(prefix="/users", tags=["users"])
    get_current_user = build_current_user_dependency(services.auth_service)

    @router.post(
        "",
        response_model=UserResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses={
            409: {"model": UserErrorResponse},
            422: {"model": UserErrorResponse},
            500: {"model": UserErrorResponse},
        },
    )
    def create_user(user: UserCreate):
        logger.info("Received create user request", extra={"email": str(user.email)})
        try:
            record = services.user_service.create_user(user)
        except DuplicateUserEmailError:
            return json_api_error_response(
                UserErrorResponse,
                status.HTTP_409_CONFLICT,
                "email_conflict",
                "Email already registered",
                "A user with this email already exists.",
                "/email",
            )
        return UserResponse(data=_to_resource(record))

    @router.patch(
        "/{user_id}",
        response_model=UserResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": UserErrorResponse},
            403: {"model": UserErrorResponse},
            404: {"model": UserErrorResponse},
            409: {"model": UserErrorResponse},
            422: {"model": UserErrorResponse},
            500: {"model": UserErrorResponse},
        },
    )
    def update_user(
        user_id: int = Path(gt=0),
        *,
        update: UserUpdate,
        current_user: CurrentUser = Depends(get_current_user),
    ):
        logger.info("Received update user request", extra={"user_id": user_id})
        if current_user.user_id != user_id and not current_user.has_role(
            UserRole.MODERATOR, UserRole.ORGANIZER
        ):
            logger.warning(
                "Rejected update from non-owner",
                extra={"user_id": user_id, "actor_id": current_user.user_id},
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot modify another user",
            )
        try:
            record = services.user_service.update_user(user_id, update)
        except UserNotFoundError:
            return json_api_error_response(
                UserErrorResponse,
                status.HTTP_404_NOT_FOUND,
                "user_not_found",
                "User not found",
                "The user does not exist or has been deleted.",
                "/user_id",
            )
        except DuplicateUserEmailError:
            return json_api_error_response(
                UserErrorResponse,
                status.HTTP_409_CONFLICT,
                "email_conflict",
                "Email already registered",
                "A user with this email already exists.",
                "/email",
            )
        return UserResponse(data=_to_resource(record))

    app.include_router(router)


def _to_resource(user: UserRecord) -> UserResourceData:
    return UserResourceData(
        id=str(user.user_id),
        attributes=UserAttributes(
            email=user.email,
            name=user.name,
            roles=list(user.roles),
            created_at=user.created_at,
            updated_at=user.updated_at,
        ),
    )
