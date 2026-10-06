from models.auth import TokenResourceData
from models.responses.json_api import JsonApiResponse


class TokenResponse(JsonApiResponse[TokenResourceData]):
    pass


class TokenErrorResponse(JsonApiResponse[TokenResourceData]):
    pass
