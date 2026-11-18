import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Path
from fastapi import Query
from fastapi import status
from models.discussion import DiscussionAuthor
from models.discussion import ReplyAttributes
from models.discussion import ReplyCreate
from models.discussion import ReplyResourceData
from models.discussion import ThreadAttributes
from models.discussion import ThreadCreate
from models.discussion import ThreadResourceData
from models.responses.discussion import DiscussionErrorResponse
from models.responses.discussion import ReplyResponse
from models.responses.discussion import ThreadListResponse
from models.responses.discussion import ThreadResponse
from models.responses.discussion import ThreadWithRepliesResponse
from services.discussion_service import DiscussionService
from services.discussion_service import DiscussionValidationError
from services.discussion_service import ItemNotFoundError
from services.discussion_service import NotAMemberError
from services.discussion_service import parse_quest_route
from services.discussion_service import ScopeAccessDeniedError
from services.discussion_service import ThreadNotFoundError
from services.discussion_service import ThreadDetail
from services.discussion_service import ThreadPage
from services.discussion_service import ThreadRecord
from services.discussion_service import ReplyRecord
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50

DISCUSSION_ERROR_RESPONSES = {
    401: {"model": DiscussionErrorResponse},
    403: {"model": DiscussionErrorResponse},
    404: {"model": DiscussionErrorResponse},
    422: {"model": DiscussionErrorResponse},
}


def setup_discussion_router(app: FastAPI, services: Services):
    router = APIRouter(prefix="/discussions", tags=["discussions"])
    get_current_user = build_current_user_dependency(services.auth_service)
    discussion: DiscussionService = services.discussion_service

    @router.get(
        "/grove/threads",
        response_model=ThreadListResponse,
        response_model_exclude_none=True,
        responses=DISCUSSION_ERROR_RESPONSES,
    )
    def list_grove_threads(
        q: str | None = Query(None, max_length=200),
        category: str | None = Query(None, max_length=32),
        page_number: int = Query(1, alias="page[number]", ge=1),
        page_size: int = Query(
            DEFAULT_PAGE_SIZE, alias="page[size]", ge=1, le=MAX_PAGE_SIZE
        ),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        result = discussion.list_threads(
            current_user.user_id,
            "grove",
            query=q,
            category=category,
            page_number=page_number,
            page_size=page_size,
        )
        return _thread_list_response(result)

    @router.post(
        "/grove/threads",
        response_model=ThreadResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=DISCUSSION_ERROR_RESPONSES,
    )
    def create_grove_thread(
        payload: ThreadCreate,
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            record = discussion.create_thread(
                current_user.user_id,
                "grove",
                title=payload.title,
                category=payload.category,
                body=payload.body,
            )
        except DiscussionValidationError as error:
            return validation_error(str(error))
        return ThreadResponse(data=to_thread_resource(record))

    @router.get(
        "/quests/{item_id}/spaces/{space}/threads",
        response_model=ThreadListResponse,
        response_model_exclude_none=True,
        responses=DISCUSSION_ERROR_RESPONSES,
    )
    def list_quest_threads(
        item_id: int = Path(gt=0),
        space: str = Path(pattern="^(active|submitted)$"),
        q: str | None = Query(None, max_length=200),
        category: str | None = Query(None, max_length=32),
        page_number: int = Query(1, alias="page[number]", ge=1),
        page_size: int = Query(
            DEFAULT_PAGE_SIZE, alias="page[size]", ge=1, le=MAX_PAGE_SIZE
        ),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            scope = parse_quest_route(item_id, space)
            result = discussion.list_threads(
                current_user.user_id,
                scope,
                query=q,
                category=category,
                page_number=page_number,
                page_size=page_size,
            )
        except DiscussionValidationError as error:
            return validation_error(str(error))
        except ItemNotFoundError:
            return item_not_found()
        except (NotAMemberError, ScopeAccessDeniedError):
            return not_a_member()
        return _thread_list_response(result)

    @router.post(
        "/quests/{item_id}/spaces/{space}/threads",
        response_model=ThreadResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=DISCUSSION_ERROR_RESPONSES,
    )
    def create_quest_thread(
        payload: ThreadCreate,
        item_id: int = Path(gt=0),
        space: str = Path(pattern="^(active|submitted)$"),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            scope = parse_quest_route(item_id, space)
            record = discussion.create_thread(
                current_user.user_id,
                scope,
                title=payload.title,
                category=payload.category,
                body=payload.body,
            )
        except DiscussionValidationError as error:
            return validation_error(str(error))
        except ItemNotFoundError:
            return item_not_found()
        except (NotAMemberError, ScopeAccessDeniedError):
            return not_a_member()
        return ThreadResponse(data=to_thread_resource(record))

    @router.get(
        "/threads/{thread_id}",
        response_model=ThreadWithRepliesResponse,
        response_model_exclude_none=True,
        responses=DISCUSSION_ERROR_RESPONSES,
    )
    def get_thread(
        thread_id: int = Path(gt=0),
        page_number: int = Query(1, alias="page[number]", ge=1),
        page_size: int = Query(
            DEFAULT_PAGE_SIZE, alias="page[size]", ge=1, le=MAX_PAGE_SIZE
        ),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            detail = discussion.get_thread(
                current_user.user_id,
                thread_id,
                page_number=page_number,
                page_size=page_size,
            )
        except ThreadNotFoundError:
            return thread_not_found()
        except ItemNotFoundError:
            return item_not_found()
        except (NotAMemberError, ScopeAccessDeniedError):
            return not_a_member()
        except DiscussionValidationError as error:
            return validation_error(str(error))
        return _thread_detail_response(detail)

    @router.post(
        "/threads/{thread_id}/replies",
        response_model=ReplyResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=DISCUSSION_ERROR_RESPONSES,
    )
    def create_reply(
        payload: ReplyCreate,
        thread_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            reply = discussion.create_reply(
                current_user.user_id, thread_id, body=payload.body
            )
        except ThreadNotFoundError:
            return thread_not_found()
        except ItemNotFoundError:
            return item_not_found()
        except (NotAMemberError, ScopeAccessDeniedError):
            return not_a_member()
        except DiscussionValidationError as error:
            return validation_error(str(error))
        return ReplyResponse(data=to_reply_resource(reply))

    app.include_router(router)


def to_thread_resource(record: ThreadRecord) -> ThreadResourceData:
    return ThreadResourceData(
        id=str(record.thread_id),
        attributes=ThreadAttributes(
            scope=record.scope,
            title=record.title,
            category=record.category,
            body=record.body,
            author=DiscussionAuthor(
                id=str(record.author.user_id), name=record.author.name
            ),
            created_at=record.created_at,
            reply_count=record.reply_count,
        ),
    )


def to_reply_resource(record: ReplyRecord) -> ReplyResourceData:
    return ReplyResourceData(
        id=str(record.reply_id),
        attributes=ReplyAttributes(
            thread_id=str(record.thread_id),
            body=record.body,
            author=DiscussionAuthor(
                id=str(record.author.user_id), name=record.author.name
            ),
            created_at=record.created_at,
        ),
    )


def _page_meta(result: ThreadPage) -> dict:
    return {
        "number": result.page_number,
        "size": result.page_size,
        "total_items": result.total_items,
        "total_pages": result.total_pages,
    }


def _thread_list_response(result: ThreadPage) -> ThreadListResponse:
    return ThreadListResponse(
        data=[to_thread_resource(thread) for thread in result.threads],
        meta={"page": _page_meta(result)},
    )


def _thread_detail_response(detail: ThreadDetail) -> ThreadWithRepliesResponse:
    reply_page = detail.replies
    return ThreadWithRepliesResponse(
        data=to_thread_resource(detail.thread),
        meta={
            "replies": [to_reply_resource(reply) for reply in reply_page.replies],
            "page": {
                "number": reply_page.page_number,
                "size": reply_page.page_size,
                "total_items": reply_page.total_items,
                "total_pages": reply_page.total_pages,
            },
        },
    )


def validation_error(detail: str):
    return json_api_error_response(
        DiscussionErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "validation_error",
        "Invalid request",
        detail,
        None,
    )


def not_a_member():
    return json_api_error_response(
        DiscussionErrorResponse,
        status.HTTP_403_FORBIDDEN,
        "not_a_member",
        "Not a member",
        "You cannot read or post in this discussion space.",
        None,
    )


def item_not_found():
    return json_api_error_response(
        DiscussionErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "item_not_found",
        "Quest not found",
        "There is no published quest with that id.",
        None,
    )


def thread_not_found():
    return json_api_error_response(
        DiscussionErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "thread_not_found",
        "Thread not found",
        "There is no discussion thread with that id.",
        "/thread_id",
    )