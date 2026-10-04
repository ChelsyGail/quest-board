from fastapi import APIRouter
from fastapi import FastAPI
from models.responses.health import HealthResource
from models.responses.health import HealthResponse
from utilities.services import Services


def setup_health_router(app: FastAPI, services: Services):
    router = APIRouter()

    @router.get(
        "/health",
        response_model=HealthResponse,
        response_model_exclude_none=True,
    )
    def health_check():
        status = "ok" if services.health_service.check_health() else "unhealthy"
        resource = HealthResource(
            type="health",
            id="service",
            attributes={"status": status},
        )
        return HealthResponse(data=resource)

    app.include_router(router)
