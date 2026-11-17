import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from models.recognition import PointsAttributes
from models.recognition import PointsResourceData
from models.responses.recognition import PointsResponse
from models.responses.recognition import RecognitionErrorResponse
from services.recognition_service import PointBalance
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.services import Services

logger = logging.getLogger(__name__)


def setup_recognition_router(app: FastAPI, services: Services):
    router = APIRouter(prefix="/users/me", tags=["recognition"])
    get_current_user = build_current_user_dependency(services.auth_service)

    @router.get(
        "/points",
        response_model=PointsResponse,
        response_model_exclude_none=True,
        responses={401: {"model": RecognitionErrorResponse}},
    )
    def get_my_points(current_user: CurrentUser = Depends(get_current_user)):
        """BE-55: lifetime earned points and spendable points, kept apart."""
        balance = services.recognition_service.get_balance(current_user.user_id)
        return PointsResponse(data=to_points_resource(current_user.user_id, balance))

    app.include_router(router)


def to_points_resource(user_id: int, balance: PointBalance) -> PointsResourceData:
    return PointsResourceData(
        id=str(user_id),
        attributes=PointsAttributes(
            total_points=balance.total_points,
            available_points=balance.available_points,
        ),
    )
