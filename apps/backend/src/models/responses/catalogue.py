from models.catalogue import ItemResourceData
from models.responses.json_api import JsonApiResponse


class ItemResponse(JsonApiResponse[ItemResourceData]):
    pass


class ItemErrorResponse(JsonApiResponse[ItemResourceData]):
    pass
