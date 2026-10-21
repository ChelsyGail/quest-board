from models.catalogue import ItemResourceData
from models.catalogue import ParticipantResourceData
from models.responses.json_api import JsonApiResponse


class ItemResponse(JsonApiResponse[ItemResourceData]):
    pass


class ItemErrorResponse(JsonApiResponse[ItemResourceData]):
    pass


class ParticipantListResponse(JsonApiResponse[ParticipantResourceData]):
    pass


class ItemListResponse(JsonApiResponse[ItemResourceData]):
    pass
