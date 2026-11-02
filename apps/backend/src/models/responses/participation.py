from models.participation import ParticipationResourceData
from models.responses.json_api import JsonApiResponse


class ParticipationResponse(JsonApiResponse[ParticipationResourceData]):
    pass


class ParticipationErrorResponse(JsonApiResponse[ParticipationResourceData]):
    pass
