from models.responses.json_api import JsonApiResponse
from models.users import UserResourceData


class UserResponse(JsonApiResponse[UserResourceData]):
    pass


class UserErrorResponse(JsonApiResponse[UserResourceData]):
    pass
