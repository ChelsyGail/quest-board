import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Path
from fastapi import status
from models.responses.reward import RewardErrorResponse
from models.responses.reward import RewardResponse
from models.reward import EligibilityRuleAttributes
from models.reward import RewardAttributes
from models.reward import RewardCreate
from models.reward import RewardResourceData
from models.reward import RewardUpdate
from models.users import UserRole
from services.reward_service import InvalidRuleQuestError
from services.reward_service import RewardNotFoundError
from services.reward_service import RewardOwnershipError
from services.reward_service import RewardRecord
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.auth import require_roles
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)


def setup_reward_router(app: FastAPI, services: Services):
    router = APIRouter(prefix="/rewards", tags=["rewards"])
    get_current_user = build_current_user_dependency(services.auth_service)
    require_organizer = require_roles(get_current_user, UserRole.ORGANIZER)

    @router.post(
        "",
        response_model=RewardResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses={
            401: {"model": RewardErrorResponse},
            403: {"model": RewardErrorResponse},
            422: {"model": RewardErrorResponse},
        },
    )
    def create_reward(
        reward: RewardCreate,
        current_user: CurrentUser = Depends(require_organizer),
    ):
        """BE-62: an organizer defines a reward with an eligibility rule and an
        optional point cost."""
        try:
            record = services.reward_service.create_reward(current_user.user_id, reward)
        except InvalidRuleQuestError:
            return _invalid_rule_quest()
        return RewardResponse(data=to_reward_resource(record))

    @router.patch(
        "/{reward_id}",
        response_model=RewardResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": RewardErrorResponse},
            403: {"model": RewardErrorResponse},
            404: {"model": RewardErrorResponse},
            422: {"model": RewardErrorResponse},
        },
    )
    def update_reward(
        reward_id: int = Path(gt=0),
        *,
        update: RewardUpdate,
        current_user: CurrentUser = Depends(require_organizer),
    ):
        try:
            record = services.reward_service.update_reward(
                reward_id, current_user.user_id, update
            )
        except RewardNotFoundError:
            return reward_not_found()
        except RewardOwnershipError:
            return reward_not_owned()
        except InvalidRuleQuestError:
            return _invalid_rule_quest()
        return RewardResponse(data=to_reward_resource(record))

    app.include_router(router)


def to_reward_attributes(record: RewardRecord) -> RewardAttributes:
    rule = record.rule
    return RewardAttributes(
        owner_id=str(record.owner_id),
        name=record.name,
        description=record.description,
        eligibility=EligibilityRuleAttributes(
            type=rule.type,
            threshold=rule.threshold,
            category=rule.category,
            quest_id=str(rule.item_id) if rule.item_id is not None else None,
        ),
        point_cost=record.point_cost,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def to_reward_resource(record: RewardRecord) -> RewardResourceData:
    return RewardResourceData(
        id=str(record.reward_id), attributes=to_reward_attributes(record)
    )


def reward_not_found():
    return json_api_error_response(
        RewardErrorResponse,
        status.HTTP_404_NOT_FOUND,
        "reward_not_found",
        "Reward not found",
        "There is no reward with that id.",
        "/reward_id",
    )


def reward_not_owned():
    return json_api_error_response(
        RewardErrorResponse,
        status.HTTP_403_FORBIDDEN,
        "reward_not_owned",
        "Not your reward",
        "Only the organizer who created this reward can do that.",
        "/reward_id",
    )


def _invalid_rule_quest():
    return json_api_error_response(
        RewardErrorResponse,
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "invalid_rule_quest",
        "Invalid quest in eligibility rule",
        "A quest_completed rule must name one of your own quests.",
        "/eligibility/quest_id",
    )
