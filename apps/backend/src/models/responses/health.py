from typing import Literal

from models.responses.json_api import JsonApiResource
from models.responses.json_api import JsonApiResponse
from pydantic import BaseModel


class HealthAttributes(BaseModel):
    status: Literal["ok", "unhealthy"]


class HealthResource(JsonApiResource):
    attributes: HealthAttributes


class HealthResponse(JsonApiResponse[HealthResource]):
    pass
