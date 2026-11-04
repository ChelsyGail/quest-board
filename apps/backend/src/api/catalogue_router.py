import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Path
from fastapi import status
from models.catalogue import EventCreate
from models.catalogue import ItemAttributes
from models.catalogue import ItemResourceData
from models.catalogue import ItemUpdate
from models.catalogue import ParticipantAttributes
from models.catalogue import ParticipantResourceData
from models.catalogue import QuestCreate
from models.responses.catalogue import ItemErrorResponse
from models.responses.catalogue import ItemResponse
from models.responses.catalogue import ParticipantListResponse
from models.users import UserRole
from services.catalogue_service import InvalidTimeWindowError
from services.catalogue_service import ItemAlreadyPublishedError
from services.catalogue_service import ItemArchivedError
from services.catalogue_service import ItemNotFoundError
from services.catalogue_service import ItemOwnershipError
from services.catalogue_service import ItemRecord
from services.catalogue_service import ParticipantRecord
from services.catalogue_service import QuestOnlyFieldError
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.auth import require_roles
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)

CREATE_ERROR_RESPONSES = {
    401: {"model": ItemErrorResponse},
    403: {"model": ItemErrorResponse},
    422: {"model": ItemErrorResponse},
}

CHANGE_ERROR_RESPONSES = {
    401: {"model": ItemErrorResponse},
    403: {"model": ItemErrorResponse},
    404: {"model": ItemErrorResponse},
    409: {"model": ItemErrorResponse},
    422: {"model": ItemErrorResponse},
}


def setup_catalogue_router(app: FastAPI, services: Services):
    router = APIRouter(tags=["catalogue"])
    get_current_user = build_current_user_dependency(services.auth_service)
    require_organizer = require_roles(get_current_user, UserRole.ORGANIZER)

    @router.post(
        "/events",
        response_model=ItemResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=CREATE_ERROR_RESPONSES,
    )
    def create_event(
        event: EventCreate,
        current_user: CurrentUser = Depends(require_organizer),
    ):
        record = services.catalogue_service.create_event(current_user.user_id, event)
        return ItemResponse(data=_to_resource(record))

    @router.post(
        "/quests",
        response_model=ItemResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=CREATE_ERROR_RESPONSES,
    )
    def create_quest(
        quest: QuestCreate,
        current_user: CurrentUser = Depends(require_organizer),
    ):
        record = services.catalogue_service.create_quest(current_user.user_id, quest)
        return ItemResponse(data=_to_resource(record))

    @router.get(
        "/items/me",
        response_model=ItemResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": ItemErrorResponse},
            403: {"model": ItemErrorResponse},
        },
    )
    def list_my_items(current_user: CurrentUser = Depends(require_organizer)):
        records = services.catalogue_service.list_my_items(current_user.user_id)
        return ItemResponse(data=[_to_resource(r) for r in records])

    @router.get(
        "/items/{item_id}",
        response_model=ItemResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": ItemErrorResponse},
            404: {"model": ItemErrorResponse},
        },
    )
    def get_item(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            record = services.catalogue_service.get_item(item_id, current_user.user_id)
        except ItemNotFoundError:
            return _not_found()
        return ItemResponse(data=_to_resource(record))

    @router.patch(
        "/items/{item_id}",
        response_model=ItemResponse,
        response_model_exclude_none=True,
        responses=CHANGE_ERROR_RESPONSES,
    )
    def update_item(
        item_id: int = Path(gt=0),
        *,
        update: ItemUpdate,
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            record = services.catalogue_service.update_item(
                item_id, current_user.user_id, update
            )
        except ItemNotFoundError:
            return _not_found()
        except ItemOwnershipError:
            return _forbidden()
        except ItemArchivedError:
            return _archived()
        except QuestOnlyFieldError as error:
            return json_api_error_response(
                ItemErrorResponse,
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "quest_only_field",
                "Field not allowed on events",
                "Only quests have proof instructions and a point value.",
                f"/{error.fields[0]}",
            )
        except InvalidTimeWindowError:
            return json_api_error_response(
                ItemErrorResponse,
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "invalid_time_window",
                "Invalid time window",
                "ends_at must be after starts_at.",
                "/ends_at",
            )
        return ItemResponse(data=_to_resource(record))

    @router.post(
        "/items/{item_id}/publish",
        response_model=ItemResponse,
        response_model_exclude_none=True,
        responses=CHANGE_ERROR_RESPONSES,
    )
    def publish_item(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            record = services.catalogue_service.publish_item(
                item_id, current_user.user_id
            )
        except ItemNotFoundError:
            return _not_found()
        except ItemOwnershipError:
            return _forbidden()
        except ItemArchivedError:
            return _archived()
        except ItemAlreadyPublishedError:
            return json_api_error_response(
                ItemErrorResponse,
                status.HTTP_409_CONFLICT,
                "item_already_published",
                "Item already published",
                "This item is already visible to students.",
            )
        return ItemResponse(data=_to_resource(record))

    @router.get(
        "/items/{item_id}/participants",
        response_model=ParticipantListResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": ItemErrorResponse},
            403: {"model": ItemErrorResponse},
            404: {"model": ItemErrorResponse},
        },
    )
    def list_participants(
        item_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            records = services.catalogue_service.list_participants(
                item_id, current_user.user_id
            )
        except ItemNotFoundError:
            return _not_found()
        except ItemOwnershipError:
            return _forbidden()
        return ParticipantListResponse(
            data=[_to_participant(r) for r in records],
            meta={"count": len(records)},
        )

    app.include_router(router)


def _not_found():
    return json_api_error_response(
        ItemErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "item_not_found",
        "Item not found",
        "The item does not exist or is not available.",
        "/item_id",
    )


def _forbidden():
    return json_api_error_response(
        ItemErrorResponse,
        status.HTTP_403_FORBIDDEN,
        "item_not_owned",
        "Not your item",
        "Only the organizer who created this item can change it.",
        "/item_id",
    )


def _archived():
    return json_api_error_response(
        ItemErrorResponse,
        status.HTTP_409_CONFLICT,
        "item_archived",
        "Item archived",
        "Archived items cannot be changed.",
        "/item_id",
    )


def _to_resource(record: ItemRecord) -> ItemResourceData:
    return ItemResourceData(
        id=str(record.item_id),
        attributes=ItemAttributes(
            kind=record.kind,
            owner_id=str(record.owner_id),
            title=record.title,
            description=record.description,
            location=record.location,
            starts_at=record.starts_at,
            ends_at=record.ends_at,
            time_zone=record.time_zone,
            category=record.category,
            proof_instructions=record.proof_instructions,
            point_value=record.point_value,
            status=record.status,
            published_at=record.published_at,
            archived_at=record.archived_at,
            created_at=record.created_at,
            updated_at=record.updated_at,
        ),
    )


def _to_participant(record: ParticipantRecord) -> ParticipantResourceData:
    return ParticipantResourceData(
        id=str(record.participation_id),
        attributes=ParticipantAttributes(
            user_id=str(record.user_id),
            name=record.name,
            status=record.status,
            joined_at=record.joined_at,
        ),
    )
