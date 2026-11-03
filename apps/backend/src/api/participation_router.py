import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Path
from fastapi import Response
from fastapi import status
from models.participation import ParticipationAttributes
from models.participation import ParticipationResourceData
from models.responses.participation import ParticipationErrorResponse
from models.responses.participation import ParticipationResponse
from services.participation_service import AlreadyJoinedError
from services.participation_service import ItemNotAvailableError
from services.participation_service import NotJoinedError
from services.participation_service import ParticipationLockedError
from services.participation_service import ParticipationRecord
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)

JOIN_ERROR_RESPONSES = {
    401: {"model": ParticipationErrorResponse},
    404: {"model": ParticipationErrorResponse},
    409: {"model": ParticipationErrorResponse},
    422: {"model": ParticipationErrorResponse},
}


def setup_participation_router(app: FastAPI, services: Services):
    router = APIRouter(tags=["participation"])
    get_current_user = build_current_user_dependency(services.auth_service)

    @router.post(
        "/items/{item_id}/join",
        response_model=ParticipationResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=JOIN_ERROR_RESPONSES,
    )
    def join_item(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            record = services.participation_service.join_item(
                current_user.user_id, item_id
            )
        except ItemNotAvailableError:
            return _item_not_available()
        except AlreadyJoinedError:
            return _already_joined()
        return ParticipationResponse(data=_to_resource(record))

    @router.delete(
        "/items/{item_id}/join",
        status_code=status.HTTP_204_NO_CONTENT,
        responses=JOIN_ERROR_RESPONSES,
    )
    def leave_item(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            services.participation_service.leave_item(current_user.user_id, item_id)
        except NotJoinedError:
            return _not_joined()
        except ParticipationLockedError:
            return _proof_already_submitted()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    app.include_router(router)


def _item_not_available():
    return json_api_error_response(
        ParticipationErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "item_not_found",
        "Item not found",
        "The item does not exist or is not available.",
        "/item_id",
    )


def _already_joined():
    return json_api_error_response(
        ParticipationErrorResponse,
        status.HTTP_409_CONFLICT,
        "already_joined",
        "Already joined",
        "You have already joined this item.",
        "/item_id",
    )


def _not_joined():
    return json_api_error_response(
        ParticipationErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "not_joined",
        "Not joined",
        "You have not joined this item.",
        "/item_id",
    )


def _proof_already_submitted():
    return json_api_error_response(
        ParticipationErrorResponse,
        status.HTTP_409_CONFLICT,
        "proof_already_submitted",
        "Proof already submitted",
        "You cannot leave an item you have already submitted proof for.",
        "/item_id",
    )


def _to_resource(record: ParticipationRecord) -> ParticipationResourceData:
    return ParticipationResourceData(
        id=str(record.participation_id),
        attributes=ParticipationAttributes(
            item_id=str(record.item_id),
            user_id=str(record.user_id),
            status=record.status,
            joined_at=record.joined_at,
        ),
    )
