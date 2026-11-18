from models.responses.json_api import JsonApiResponse
from models.reward import RewardResourceData


class RewardResponse(JsonApiResponse[RewardResourceData]):
    pass


class RewardListResponse(JsonApiResponse[RewardResourceData]):
    pass


class RewardErrorResponse(JsonApiResponse[RewardResourceData]):
    pass
