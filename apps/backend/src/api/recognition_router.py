import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from models.recognition import AchievementsAttributes
from models.recognition import AchievementsResourceData
from models.recognition import BadgeSummary
from models.recognition import CompletedQuest
from models.recognition import PointsAttributes
from models.recognition import PointsResourceData
from models.responses.recognition import AchievementsResponse
from models.responses.recognition import PointsResponse
from models.responses.recognition import RecognitionErrorResponse
from services.recognition_service import Achievements
from services.recognition_service import BadgeAwardRecord
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

    @router.get(
        "/achievements",
        response_model=AchievementsResponse,
        response_model_exclude_none=True,
        responses={401: {"model": RecognitionErrorResponse}},
    )
    def get_my_achievements(current_user: CurrentUser = Depends(get_current_user)):
        """BE-57: points, badges and approved quests for the signed-in user."""
        achievements = services.recognition_service.get_achievements(
            current_user.user_id
        )
        return AchievementsResponse(
            data=_to_achievements(current_user.user_id, achievements)
        )

    app.include_router(router)


def to_badge_summary(badge: BadgeAwardRecord) -> BadgeSummary:
    return BadgeSummary(
        badge_id=str(badge.badge_id),
        name=badge.name,
        description=badge.description,
        awarded_at=badge.awarded_at,
    )


def _to_achievements(
    user_id: int, achievements: Achievements
) -> AchievementsResourceData:
    return AchievementsResourceData(
        id=str(user_id),
        attributes=AchievementsAttributes(
            total_points=achievements.balance.total_points,
            available_points=achievements.balance.available_points,
            badges=[to_badge_summary(badge) for badge in achievements.badges],
            completed_quests=[
                CompletedQuest(
                    item_id=str(quest.item_id),
                    title=quest.title,
                    category=quest.category,
                    points=quest.points,
                    approved_at=quest.approved_at,
                )
                for quest in achievements.completed_quests
            ],
        ),
    )


def to_points_resource(user_id: int, balance: PointBalance) -> PointsResourceData:
    return PointsResourceData(
        id=str(user_id),
        attributes=PointsAttributes(
            total_points=balance.total_points,
            available_points=balance.available_points,
        ),
    )
