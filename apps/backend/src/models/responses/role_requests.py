from models.responses.json_api import JsonApiResponse
from models.role_requests import RoleRequestResourceData


class RoleRequestResponse(JsonApiResponse[RoleRequestResourceData]):
    pass


class RoleRequestErrorResponse(JsonApiResponse[RoleRequestResourceData]):
    pass
