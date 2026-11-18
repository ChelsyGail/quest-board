from models.recognition import AchievementsResourceData
from models.recognition import PointsResourceData
from models.responses.json_api import JsonApiResponse


class PointsResponse(JsonApiResponse[PointsResourceData]):
    pass


class AchievementsResponse(JsonApiResponse[AchievementsResourceData]):
    pass


class RecognitionErrorResponse(JsonApiResponse[PointsResourceData]):
    pass
