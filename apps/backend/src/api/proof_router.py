import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Header
from fastapi import Path
from fastapi import Request
from fastapi import status
from fastapi.concurrency import run_in_threadpool
from models.proof import MediaAttributes
from models.proof import MediaResourceData
from models.proof import SubmissionAttributes
from models.proof import SubmissionCreate
from models.proof import SubmissionMedia
from models.proof import SubmissionResourceData
from models.responses.proof import MediaErrorResponse
from models.responses.proof import MediaResponse
from models.responses.proof import SubmissionErrorResponse
from models.responses.proof import SubmissionListResponse
from models.responses.proof import SubmissionResponse
from services.proof_service import EmptySubmissionError
from services.proof_service import EmptyUploadError
from services.proof_service import MediaContentMismatchError
from services.proof_service import MediaNotUsableError
from services.proof_service import MediaRecord
from services.proof_service import MediaTooLargeError
from services.proof_service import NotYourParticipationError
from services.proof_service import ParticipationNotFoundError
from services.proof_service import ProofNotAcceptedError
from services.proof_service import SubmissionRecord
from services.proof_service import UnsupportedMediaTypeError
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.json_api_errors import json_api_error_response
from utilities.media_types import ALLOWED_MEDIA_TYPES
from utilities.media_types import MAX_UPLOAD_BYTES
from utilities.media_types import normalise_content_type
from utilities.services import Services

logger = logging.getLogger(__name__)

SUBMISSION_ERROR_RESPONSES = {
    401: {"model": SubmissionErrorResponse},
    403: {"model": SubmissionErrorResponse},
    404: {"model": SubmissionErrorResponse},
    409: {"model": SubmissionErrorResponse},
    422: {"model": SubmissionErrorResponse},
}


class _UploadTooLarge(Exception):
    pass


def setup_proof_router(app: FastAPI, services: Services):
    router = APIRouter(tags=["proof"])
    get_current_user = build_current_user_dependency(services.auth_service)

    @router.post(
        "/uploads",
        response_model=MediaResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses={
            401: {"model": MediaErrorResponse},
            422: {"model": MediaErrorResponse},
        },
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    content_type: {"schema": {"type": "string", "format": "binary"}}
                    for content_type in ALLOWED_MEDIA_TYPES
                },
            }
        },
    )
    async def upload_media(
        request: Request,
        content_type: str | None = Header(None),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        """Upload one photo or video as the raw request body, with its type in the
        Content-Type header. Returns the media id to put in a submission."""
        try:
            data = await _read_body(request, MAX_UPLOAD_BYTES)
        except _UploadTooLarge:
            return _media_too_large(MAX_UPLOAD_BYTES)
        try:
            record = await run_in_threadpool(
                services.proof_service.store_upload,
                current_user.user_id,
                normalise_content_type(content_type),
                data,
            )
        except UnsupportedMediaTypeError:
            return _unsupported_media_type()
        except EmptyUploadError:
            return _empty_upload()
        except MediaTooLargeError as error:
            return _media_too_large(error.limit_bytes)
        except MediaContentMismatchError:
            return _media_content_mismatch()
        return MediaResponse(data=to_media_resource(record))

    @router.post(
        "/participations/{participation_id}/submissions",
        response_model=SubmissionResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses=SUBMISSION_ERROR_RESPONSES,
    )
    def submit_proof(
        submission: SubmissionCreate,
        participation_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            record = services.proof_service.submit(
                current_user.user_id, participation_id, submission
            )
        except ParticipationNotFoundError:
            return _participation_not_found()
        except NotYourParticipationError:
            return _not_your_participation()
        except ProofNotAcceptedError:
            return _proof_not_accepted()
        except EmptySubmissionError:
            return _empty_submission()
        except MediaNotUsableError as error:
            return _media_not_usable(error.index)
        return SubmissionResponse(data=to_submission_resource(record))

    @router.get(
        "/participations/{participation_id}/submissions",
        response_model=SubmissionListResponse,
        response_model_exclude_none=True,
        responses=SUBMISSION_ERROR_RESPONSES,
    )
    def list_submissions(
        participation_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            records = services.proof_service.list_submissions(
                current_user.user_id, participation_id
            )
        except ParticipationNotFoundError:
            return _participation_not_found()
        except NotYourParticipationError:
            return _not_your_participation()
        return SubmissionListResponse(
            data=[to_submission_resource(record) for record in records],
            meta={"count": len(records)},
        )

    app.include_router(router)


async def _read_body(request: Request, limit: int) -> bytes:
    """Reads the upload, giving up as soon as it passes the largest limit rather
    than buffering whatever a client decides to send."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise _UploadTooLarge
    chunks = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > limit:
            raise _UploadTooLarge
        chunks.append(chunk)
    return b"".join(chunks)


def to_media_resource(record: MediaRecord) -> MediaResourceData:
    return MediaResourceData(
        id=str(record.media_id),
        attributes=MediaAttributes(
            content_type=record.content_type,
            kind=record.kind,
            size_bytes=record.size_bytes,
            uploaded_at=record.uploaded_at,
        ),
    )


def to_submission_media(record: MediaRecord) -> SubmissionMedia:
    return SubmissionMedia(
        id=str(record.media_id),
        content_type=record.content_type,
        kind=record.kind,
        size_bytes=record.size_bytes,
    )


def to_submission_resource(record: SubmissionRecord) -> SubmissionResourceData:
    return SubmissionResourceData(
        id=str(record.submission_id),
        attributes=SubmissionAttributes(
            participation_id=str(record.participation_id),
            item_id=str(record.item_id),
            user_id=str(record.user_id),
            attempt_number=record.attempt_number,
            text=record.text,
            media=[to_submission_media(media) for media in record.media],
            status=record.status,
            submitted_at=record.submitted_at,
        ),
    )


def _participation_not_found():
    return json_api_error_response(
        SubmissionErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "participation_not_found",
        "Participation not found",
        "There is no participation with that id.",
        "/participation_id",
    )


def _not_your_participation():
    return json_api_error_response(
        SubmissionErrorResponse,
        status.HTTP_403_FORBIDDEN,
        "participation_not_owned",
        "Not your participation",
        "You can only submit or view proof for quests you joined yourself.",
        "/participation_id",
    )


def _proof_not_accepted():
    return json_api_error_response(
        SubmissionErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "proof_is_for_quests",
        "Proof is for quests",
        "Only quests take proof. An event RSVP has nothing to submit.",
        "/participation_id",
    )


def _empty_submission():
    return json_api_error_response(
        SubmissionErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "proof_missing",
        "Proof missing",
        "Add a description, a photo or a video before submitting.",
        "/text",
    )


def _media_not_usable(index: int):
    return json_api_error_response(
        SubmissionErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "media_not_usable",
        "Upload cannot be used",
        "This upload does not exist, is not yours, or is already part of an attempt.",
        f"/media_ids/{index}",
    )


def _unsupported_media_type():
    allowed = ", ".join(sorted(ALLOWED_MEDIA_TYPES))
    return json_api_error_response(
        MediaErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "unsupported_media_type",
        "Unsupported file type",
        f"Upload a photo or video. Accepted types: {allowed}.",
        "/content_type",
    )


def _media_content_mismatch():
    return json_api_error_response(
        MediaErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "media_content_mismatch",
        "File does not match its type",
        "The file's contents do not match the Content-Type it was sent with.",
        "/content_type",
    )


def _empty_upload():
    return json_api_error_response(
        MediaErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "empty_upload",
        "Empty upload",
        "The upload contained no data.",
        "/size_bytes",
    )


def _media_too_large(limit_bytes: int):
    megabytes = limit_bytes // (1024 * 1024)
    return json_api_error_response(
        MediaErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "media_too_large",
        "File too large",
        f"Files of this type can be at most {megabytes} MB.",
        "/size_bytes",
    )
