from models.proof import MediaResourceData
from models.proof import SubmissionResourceData
from models.responses.json_api import JsonApiResponse


class SubmissionResponse(JsonApiResponse[SubmissionResourceData]):
    pass


class SubmissionListResponse(JsonApiResponse[SubmissionResourceData]):
    pass


class SubmissionErrorResponse(JsonApiResponse[SubmissionResourceData]):
    pass


class MediaResponse(JsonApiResponse[MediaResourceData]):
    pass


class MediaErrorResponse(JsonApiResponse[MediaResourceData]):
    pass
