import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import status
from models.catalogue import ItemAttributes
from models.catalogue import ItemResourceData
from models.catalogue import QuestCreate
from models.responses.catalogue import ItemErrorResponse
from models.responses.catalogue import ItemResponse
from models.users import UserRole
from services.catalogue_service import ItemRecord
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.auth import require_roles
from utilities.services import Services

logger = logging.getLogger(__name__)

CREATE_ERROR_RESPONSES = {
    401: {"model": ItemErrorResponse},
    403: {"model": ItemErrorResponse},
    422: {"model": ItemErrorResponse},
}


def setup_catalogue_router(app: FastAPI, services: Services):
    router = APIRouter(tags=["catalogue"])
    get_current_user = build_current_user_dependency(services.auth_service)
    require_organizer = require_roles(get_current_user, UserRole.ORGANIZER)

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

    app.include_router(router)


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
