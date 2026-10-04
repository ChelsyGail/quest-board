import logging

from api.auth_router import setup_auth_router
from api.health_router import setup_health_router
from api.user_router import setup_user_router
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from models.responses.json_api import JsonApiError
from models.responses.json_api import JsonApiErrorSource
from models.responses.json_api import JsonApiResponse
from utilities.services import Services

app = FastAPI()
logger = logging.getLogger(__name__)


def setup_app(services: Services) -> FastAPI:
    app = FastAPI(title="Backend API", root_path="/api/v1")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exception: RequestValidationError
    ):
        logger.warning(
            "Request validation failed",
            extra={"path": request.url.path, "error_count": len(exception.errors())},
        )
        errors = []
        for error in exception.errors():
            location = [str(part) for part in error["loc"] if part != "body"]
            pointer = "/" + "/".join(location)
            errors.append(
                JsonApiError(
                    status="422",
                    code=error["type"],
                    title="Invalid request",
                    detail=error["msg"],
                    source=JsonApiErrorSource(pointer=pointer),
                )
            )
        document = JsonApiResponse(errors=errors)
        return JSONResponse(
            status_code=422,
            content=document.model_dump(mode="json", exclude_none=True),
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exception: HTTPException):
        logger.warning(
            "Request rejected",
            extra={"path": request.url.path, "status_code": exception.status_code},
        )
        document = JsonApiResponse(
            errors=[
                JsonApiError(
                    status=str(exception.status_code),
                    code="request_rejected",
                    title="Request rejected",
                    detail=str(exception.detail),
                )
            ]
        )
        return JSONResponse(
            status_code=exception.status_code,
            content=document.model_dump(mode="json", exclude_none=True),
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exception: Exception):
        logger.exception(
            "Unhandled request error",
            exc_info=exception,
            extra={"path": request.url.path},
        )
        document = JsonApiResponse(
            errors=[
                JsonApiError(
                    status="500",
                    code="internal_server_error",
                    title="Internal server error",
                    detail="The request could not be completed.",
                )
            ]
        )
        return JSONResponse(
            status_code=500,
            content=document.model_dump(mode="json", exclude_none=True),
        )

    setup_health_router(app, services)
    setup_auth_router(app, services)
    setup_user_router(app, services)

    return app
