from models.responses.json_api import JsonApiResponse
from models.review import AuditEntryResourceData
from models.review import QueueEntryResourceData
from models.review import ReviewResourceData
from models.review import SubmissionDetailResourceData


class QueueResponse(JsonApiResponse[QueueEntryResourceData]):
    pass


class ReviewErrorResponse(JsonApiResponse[QueueEntryResourceData]):
    pass


class SubmissionDetailResponse(JsonApiResponse[SubmissionDetailResourceData]):
    pass


class ReviewResponse(JsonApiResponse[ReviewResourceData]):
    pass


class AuditLogResponse(JsonApiResponse[AuditEntryResourceData]):
    pass
