from models.discussion import ReplyResourceData
from models.discussion import ThreadResourceData
from models.responses.json_api import JsonApiResponse


class ThreadResponse(JsonApiResponse[ThreadResourceData]):
    pass


class ThreadListResponse(JsonApiResponse[ThreadResourceData]):
    pass


class ThreadDetailResponse(JsonApiResponse[ThreadResourceData]):
    pass


class ReplyResponse(JsonApiResponse[ReplyResourceData]):
    pass


class ThreadWithRepliesResponse(JsonApiResponse[ThreadResourceData]):
    pass


class DiscussionErrorResponse(JsonApiResponse[ThreadResourceData]):
    pass