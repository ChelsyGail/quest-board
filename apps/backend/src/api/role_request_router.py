import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Path
from fastapi import Query
from fastapi import status
from models.responses.role_requests import RoleRequestErrorResponse
from models.responses.role_requests import RoleRequestResponse
from models.role_requests import RoleRequestAttributes
from models.role_requests import RoleRequestCreate
from models.role_requests import RoleRequestResourceData
from models.role_requests import RoleRequestStatus
from models.users import UserRole
from services.role_request_service import DuplicatePendingRoleRequestError
from services.role_request_service import RoleAlreadyHeldError
from services.role_request_service import RoleRequestAlreadyReviewedError
from services.role_request_service import RoleRequestNotFoundError
from services.role_request_service import RoleRequestRecord
from services.role_request_service import SelfReviewError
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.auth import require_roles
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)

REVIEW_ERROR_RESPONSES = {
    401: {"model": RoleRequestErrorResponse},
    403: {"model": RoleRequestErrorResponse},
    404: {"model": RoleRequestErrorResponse},
    409: {"model": RoleRequestErrorResponse},
}


def setup_role_request_router(app: FastAPI, services: Services):
    router = APIRouter(prefix="/role-requests", tags=["role-requests"])
    get_current_user = build_current_user_dependency(services.auth_service)
    require_admin = require_roles(get_current_user, UserRole.ADMIN)

    @router.post(
        "",
        response_model=RoleRequestResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses={
            401: {"model": RoleRequestErrorResponse},
            409: {"model": RoleRequestErrorResponse},
            422: {"model": RoleRequestErrorResponse},
        },
    )
    def create_role_request(
        request: RoleRequestCreate,
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            record = services.role_request_service.create_request(
                current_user.user_id, current_user.roles, request
            )
        except RoleAlreadyHeldError:
            return json_api_error_response(
                RoleRequestErrorResponse,
                status.HTTP_409_CONFLICT,
                "role_already_held",
                "Role already held",
                "You already have this role.",
                "/role",
            )
        except DuplicatePendingRoleRequestError:
            return json_api_error_response(
                RoleRequestErrorResponse,
                status.HTTP_409_CONFLICT,
                "role_request_pending",
                "Request already pending",
                "You already have a pending request for this role.",
                "/role",
            )
        return RoleRequestResponse(data=_to_resource(record))

    @router.get(
        "/me",
        response_model=RoleRequestResponse,
        response_model_exclude_none=True,
        responses={401: {"model": RoleRequestErrorResponse}},
    )
    def list_my_role_requests(current_user: CurrentUser = Depends(get_current_user)):
        records = services.role_request_service.list_requests(
            user_id=current_user.user_id
        )
        return RoleRequestResponse(data=[_to_resource(r) for r in records])

    @router.get(
        "",
        response_model=RoleRequestResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": RoleRequestErrorResponse},
            403: {"model": RoleRequestErrorResponse},
        },
    )
    def list_role_requests(
        request_status: RoleRequestStatus = Query(
            default=RoleRequestStatus.PENDING, alias="status"
        ),
        current_user: CurrentUser = Depends(require_admin),
    ):
        records = services.role_request_service.list_requests(status=request_status)
        return RoleRequestResponse(data=[_to_resource(r) for r in records])

    @router.post(
        "/{role_request_id}/approve",
        response_model=RoleRequestResponse,
        response_model_exclude_none=True,
        responses=REVIEW_ERROR_RESPONSES,
    )
    def approve_role_request(
        role_request_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(require_admin),
    ):
        return _review(
            services.role_request_service.approve_request,
            role_request_id,
            current_user,
        )

    @router.post(
        "/{role_request_id}/reject",
        response_model=RoleRequestResponse,
        response_model_exclude_none=True,
        responses=REVIEW_ERROR_RESPONSES,
    )
    def reject_role_request(
        role_request_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(require_admin),
    ):
        return _review(
            services.role_request_service.reject_request,
            role_request_id,
            current_user,
        )

    app.include_router(router)


def _review(review, role_request_id: int, current_user: CurrentUser):
    try:
        record = review(role_request_id, current_user.user_id)
    except RoleRequestNotFoundError:
        return json_api_error_response(
            RoleRequestErrorResponse,
            status.HTTP_404_NOT_FOUND,
            "role_request_not_found",
            "Role request not found",
            "The role request does not exist.",
            "/role_request_id",
        )
    except RoleRequestAlreadyReviewedError:
        return json_api_error_response(
            RoleRequestErrorResponse,
            status.HTTP_409_CONFLICT,
            "role_request_already_reviewed",
            "Role request already reviewed",
            "This request has already been approved or rejected.",
        )
    except SelfReviewError:
        return json_api_error_response(
            RoleRequestErrorResponse,
            status.HTTP_403_FORBIDDEN,
            "self_review_forbidden",
            "Cannot review own request",
            "Another admin must review your role request.",
        )
    return RoleRequestResponse(data=_to_resource(record))


def _to_resource(record: RoleRequestRecord) -> RoleRequestResourceData:
    return RoleRequestResourceData(
        id=str(record.role_request_id),
        attributes=RoleRequestAttributes(
            user_id=str(record.user_id),
            role=record.role,
            reason=record.reason,
            status=record.status,
            reviewed_by=(
                str(record.reviewed_by) if record.reviewed_by is not None else None
            ),
            reviewed_at=record.reviewed_at,
            created_at=record.created_at,
            updated_at=record.updated_at,
        ),
    )
