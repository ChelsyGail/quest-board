from models.responses.json_api import JsonApiResponse
from models.reward import ClaimResourceData
from models.reward import RewardResourceData


class RewardResponse(JsonApiResponse[RewardResourceData]):
    pass


class RewardListResponse(JsonApiResponse[RewardResourceData]):
    pass


class ClaimResponse(JsonApiResponse[ClaimResourceData]):
    pass


class ClaimListResponse(JsonApiResponse[ClaimResourceData]):
    pass


class RewardErrorResponse(JsonApiResponse[RewardResourceData]):
    pass
