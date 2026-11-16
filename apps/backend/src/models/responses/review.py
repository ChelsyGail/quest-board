from models.responses.json_api import JsonApiResponse
from models.review import QueueEntryResourceData


class QueueResponse(JsonApiResponse[QueueEntryResourceData]):
    pass


class ReviewErrorResponse(JsonApiResponse[QueueEntryResourceData]):
    pass
