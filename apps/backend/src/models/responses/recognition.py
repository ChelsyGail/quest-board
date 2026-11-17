from models.recognition import PointsResourceData
from models.responses.json_api import JsonApiResponse


class PointsResponse(JsonApiResponse[PointsResourceData]):
    pass


class RecognitionErrorResponse(JsonApiResponse[PointsResourceData]):
    pass
