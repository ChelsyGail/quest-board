from typing import TypeVar

from fastapi.responses import JSONResponse
from models.responses.json_api import JsonApiError
from models.responses.json_api import JsonApiErrorSource
from models.responses.json_api import JsonApiResponse

ResponseT = TypeVar("ResponseT", bound=JsonApiResponse)


def json_api_error_response(
    response_type: type[ResponseT],
    status_code: int,
    code: str,
    title: str,
    detail: str,
    pointer: str | None = None,
) -> JSONResponse:
    document = response_type(
        errors=[
            JsonApiError(
                status=str(status_code),
                code=code,
                title=title,
                detail=detail,
                source=JsonApiErrorSource(pointer=pointer) if pointer else None,
            )
        ]
    )
    return JSONResponse(
        status_code=status_code,
        content=document.model_dump(mode="json", exclude_none=True),
    )
