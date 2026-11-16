import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Query
from models.responses.review import QueueResponse
from models.responses.review import ReviewErrorResponse
from models.review import QueueEntryAttributes
from models.review import QueueEntryResourceData
from models.users import UserRole
from services.review_service import QueueEntry
from services.review_service import QueuePage
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.auth import require_roles
from utilities.services import Services

logger = logging.getLogger(__name__)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def setup_review_router(app: FastAPI, services: Services):
    router = APIRouter(prefix="/moderation", tags=["moderation"])
    get_current_user = build_current_user_dependency(services.auth_service)
    require_moderator = require_roles(get_current_user, UserRole.MODERATOR)

    @router.get(
        "/submissions",
        response_model=QueueResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": ReviewErrorResponse},
            403: {"model": ReviewErrorResponse},
            422: {"model": ReviewErrorResponse},
        },
    )
    def list_pending_submissions(
        page: int = Query(1, ge=1, description="1-based page number"),
        page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
        current_user: CurrentUser = Depends(require_moderator),
    ):
        result = services.review_service.list_pending(page, page_size)
        return QueueResponse(
            data=[_to_queue_entry(entry) for entry in result.entries],
            meta={"page": _page_meta(result)},
        )

    app.include_router(router)


def _to_queue_entry(entry: QueueEntry) -> QueueEntryResourceData:
    return QueueEntryResourceData(
        id=str(entry.submission_id),
        attributes=QueueEntryAttributes(
            participation_id=str(entry.participation_id),
            item_id=str(entry.item_id),
            item_title=entry.item_title,
            user_id=str(entry.user_id),
            student_name=entry.student_name,
            attempt_number=entry.attempt_number,
            has_text=entry.has_text,
            media_count=entry.media_count,
            submitted_at=entry.submitted_at,
        ),
    )


def _page_meta(result: QueuePage) -> dict:
    return {
        "number": result.page_number,
        "size": result.page_size,
        "total_items": result.total_items,
        "total_pages": result.total_pages,
    }
