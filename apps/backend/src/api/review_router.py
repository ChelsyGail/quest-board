import logging

from api.catalogue_router import to_item_attributes
from api.proof_router import to_submission_media
from api.recognition_router import to_badge_summary
from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Path
from fastapi import Query
from fastapi import Response
from fastapi import status
from models.catalogue import ItemResourceData
from models.responses.review import AuditLogResponse
from models.responses.review import QueueResponse
from models.responses.review import ReviewErrorResponse
from models.responses.review import ReviewResponse
from models.responses.review import SubmissionDetailResponse
from models.review import AuditEntryAttributes
from models.review import AuditEntryResourceData
from models.review import QueueEntryAttributes
from models.review import QueueEntryResourceData
from models.review import RejectionCreate
from models.review import ReviewAttributes
from models.review import ReviewResourceData
from models.review import StudentSummary
from models.review import SubmissionDetailAttributes
from models.review import SubmissionDetailResourceData
from models.users import UserRole
from services.moderation_audit_service import AuditEntry
from services.moderation_audit_service import AuditFilters
from services.moderation_audit_service import AuditPage
from services.proof_service import SubmissionNotFoundError
from services.review_service import NotAModeratorError
from services.review_service import QueueEntry
from services.review_service import QueuePage
from services.review_service import ReviewRecord
from services.review_service import SelfReviewError
from services.review_service import SubmissionAlreadyReviewedError
from services.review_service import SubmissionDetail
from services.review_service import SubmissionNotPendingError
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.auth import require_roles
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)

DECISION_ERROR_RESPONSES = {
    401: {"model": ReviewErrorResponse},
    403: {"model": ReviewErrorResponse},
    404: {"model": ReviewErrorResponse},
    409: {"model": ReviewErrorResponse},
    422: {"model": ReviewErrorResponse},
}

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def setup_review_router(app: FastAPI, services: Services):
    router = APIRouter(prefix="/moderation", tags=["moderation"])
    get_current_user = build_current_user_dependency(services.auth_service)
    require_moderator = require_roles(get_current_user, UserRole.MODERATOR)
    require_admin = require_roles(get_current_user, UserRole.ADMIN)

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

    @router.get(
        "/submissions/{submission_id}",
        response_model=SubmissionDetailResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": ReviewErrorResponse},
            403: {"model": ReviewErrorResponse},
            404: {"model": ReviewErrorResponse},
        },
    )
    def get_submission(
        submission_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(require_moderator),
    ):
        try:
            detail = services.review_service.get_submission(submission_id)
        except SubmissionNotFoundError:
            return submission_not_found()
        return SubmissionDetailResponse(data=_to_detail(detail))

    @router.post(
        "/submissions/{submission_id}/approve",
        response_model=ReviewResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses={
            200: {
                "model": ReviewResponse,
                "description": "Retried approval: the review it already made",
            },
            **DECISION_ERROR_RESPONSES,
        },
    )
    def approve_submission(
        response: Response,
        submission_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(require_moderator),
    ):
        try:
            record = services.review_service.approve(
                submission_id, current_user.user_id
            )
        except SubmissionNotFoundError:
            return submission_not_found()
        except NotAModeratorError:
            return _not_a_moderator()
        except SelfReviewError:
            return _self_review()
        except SubmissionAlreadyReviewedError:
            return _already_reviewed()
        except SubmissionNotPendingError:
            return _not_pending()
        if record.replayed:
            # BE-50: nothing new was created, so a retry answers 200, not 201.
            response.status_code = status.HTTP_200_OK
        return ReviewResponse(data=to_review_resource(record))

    @router.post(
        "/submissions/{submission_id}/reject",
        response_model=ReviewResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=DECISION_ERROR_RESPONSES,
    )
    def reject_submission(
        rejection: RejectionCreate,
        submission_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(require_moderator),
    ):
        try:
            record = services.review_service.reject(
                submission_id, current_user.user_id, rejection.feedback
            )
        except SubmissionNotFoundError:
            return submission_not_found()
        except NotAModeratorError:
            return _not_a_moderator()
        except SelfReviewError:
            return _self_review()
        except SubmissionAlreadyReviewedError:
            return _already_reviewed()
        except SubmissionNotPendingError:
            return _not_pending()
        return ReviewResponse(data=to_review_resource(record))

    @router.get(
        "/audit-log",
        response_model=AuditLogResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": ReviewErrorResponse},
            403: {"model": ReviewErrorResponse},
            422: {"model": ReviewErrorResponse},
        },
    )
    def list_audit_log(
        submission_id: int | None = Query(None, gt=0),
        reviewer_id: int | None = Query(None, gt=0),
        student_id: int | None = Query(None, gt=0),
        page: int = Query(1, ge=1, description="1-based page number"),
        page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
        current_user: CurrentUser = Depends(require_admin),
    ):
        """BE-52: every moderation decision, newest first, for resolving
        disputes. Admins only; filter by attempt, moderator or student."""
        result = services.moderation_audit_service.list_entries(
            AuditFilters(
                submission_id=submission_id,
                reviewer_id=reviewer_id,
                student_id=student_id,
            ),
            page,
            page_size,
        )
        return AuditLogResponse(
            data=[_to_audit_entry(entry) for entry in result.entries],
            meta={"page": _page_meta(result)},
        )

    app.include_router(router)


def to_review_resource(record: ReviewRecord) -> ReviewResourceData:
    return ReviewResourceData(
        id=str(record.review_id),
        attributes=ReviewAttributes(
            submission_id=str(record.submission_id),
            participation_id=str(record.participation_id),
            reviewer_id=str(record.reviewer_id),
            decision=record.decision,
            feedback=record.feedback,
            reviewed_at=record.reviewed_at,
            points_awarded=record.points_awarded,
            badges_awarded=[to_badge_summary(badge) for badge in record.badges_awarded],
        ),
    )


def _not_a_moderator():
    return json_api_error_response(
        ReviewErrorResponse,
        status.HTTP_403_FORBIDDEN,
        "not_a_moderator",
        "Not a moderator",
        "Only moderators can review submissions.",
    )


def _self_review():
    return json_api_error_response(
        ReviewErrorResponse,
        status.HTTP_403_FORBIDDEN,
        "self_review",
        "Cannot review your own submission",
        "Another moderator has to review an attempt you submitted.",
        "/submission_id",
    )


def _already_reviewed():
    return json_api_error_response(
        ReviewErrorResponse,
        status.HTTP_409_CONFLICT,
        "submission_already_reviewed",
        "Submission already reviewed",
        "This attempt already has its final review and cannot be decided again.",
        "/submission_id",
    )


def _not_pending():
    return json_api_error_response(
        ReviewErrorResponse,
        status.HTTP_409_CONFLICT,
        "submission_not_pending",
        "Submission is not awaiting review",
        "This attempt has already been decided or replaced by a newer one.",
        "/submission_id",
    )


def _to_detail(detail: SubmissionDetail) -> SubmissionDetailResourceData:
    submission = detail.submission
    return SubmissionDetailResourceData(
        id=str(submission.submission_id),
        attributes=SubmissionDetailAttributes(
            participation_id=str(submission.participation_id),
            attempt_number=submission.attempt_number,
            status=submission.status,
            text=submission.text,
            media=[to_submission_media(media) for media in submission.media],
            twist=None,
            submitted_at=submission.submitted_at,
            student=StudentSummary(
                user_id=str(submission.user_id), name=detail.student_name
            ),
            quest=ItemResourceData(
                id=str(detail.item.item_id),
                attributes=to_item_attributes(detail.item),
            ),
        ),
    )


def submission_not_found():
    return json_api_error_response(
        ReviewErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "submission_not_found",
        "Submission not found",
        "There is no submission with that id.",
        "/submission_id",
    )


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


def _to_audit_entry(entry: AuditEntry) -> AuditEntryResourceData:
    return AuditEntryResourceData(
        id=str(entry.audit_id),
        attributes=AuditEntryAttributes(
            review_id=str(entry.review_id),
            submission_id=str(entry.submission_id),
            participation_id=str(entry.participation_id),
            student_id=str(entry.student_id),
            student_name=entry.student_name,
            reviewer_id=str(entry.reviewer_id),
            reviewer_name=entry.reviewer_name,
            decision=entry.decision,
            feedback=entry.feedback,
            points_awarded=entry.points_awarded,
            decided_at=entry.decided_at,
        ),
    )


def _page_meta(result: QueuePage | AuditPage) -> dict:
    return {
        "number": result.page_number,
        "size": result.page_size,
        "total_items": result.total_items,
        "total_pages": result.total_pages,
    }
