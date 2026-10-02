import logging

from fastapi import APIRouter
from fastapi import FastAPI
from fastapi import status
from models.auth import LoginRequest
from models.auth import TokenAttributes
from models.auth import TokenResourceData
from models.responses.auth import TokenErrorResponse
from models.responses.auth import TokenResponse
from services.auth_service import InvalidCredentialsError
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)


def setup_auth_router(app: FastAPI, services: Services):
    router = APIRouter(prefix="/auth", tags=["auth"])

    @router.post(
        "/login",
        response_model=TokenResponse,
        response_model_exclude_none=True,
        responses={401: {"model": TokenErrorResponse}},
    )
    def login(credentials: LoginRequest):
        logger.info("Received login request", extra={"email": str(credentials.email)})
        try:
            user = services.auth_service.authenticate(
                str(credentials.email), credentials.password
            )
        except InvalidCredentialsError:
            return json_api_error_response(
                TokenErrorResponse,
                status.HTTP_401_UNAUTHORIZED,
                "invalid_credentials",
                "Invalid credentials",
                "Email or password is incorrect.",
            )

        token = services.auth_service.create_access_token(user)
        resource = TokenResourceData(
            id=str(user.user_id),
            attributes=TokenAttributes(
                access_token=token.token, expires_at=token.expires_at
            ),
        )
        return TokenResponse(data=resource)

    app.include_router(router)
