import logging

from fastapi import APIRouter
from fastapi import Depends
from fastapi import FastAPI
from fastapi import Path
from fastapi import Query
from fastapi import status
from models.responses.reward import ClaimResponse
from models.responses.reward import RewardErrorResponse
from models.responses.reward import RewardListResponse
from models.responses.reward import RewardResponse
from models.reward import ClaimAttributes
from models.reward import ClaimResourceData
from models.reward import EligibilityRuleAttributes
from models.reward import RewardAttributes
from models.reward import RewardCreate
from models.reward import RewardResourceData
from models.reward import RewardUpdate
from models.reward import RewardViewerStatus
from models.reward import RuleProgressAttributes
from models.users import UserRole
from services.reward_service import ClaimRecord
from services.reward_service import InsufficientPointsError
from services.reward_service import InvalidRuleQuestError
from services.reward_service import RewardAlreadyClaimedError
from services.reward_service import RewardNotEligibleError
from services.reward_service import RewardNotFoundError
from services.reward_service import RewardOwnershipError
from services.reward_service import RewardPage
from services.reward_service import RewardRecord
from services.reward_service import RewardView
from utilities.auth import build_current_user_dependency
from utilities.auth import CurrentUser
from utilities.auth import require_roles
from utilities.json_api_errors import json_api_error_response
from utilities.services import Services

logger = logging.getLogger(__name__)

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def setup_reward_router(app: FastAPI, services: Services):
    router = APIRouter(prefix="/rewards", tags=["rewards"])
    get_current_user = build_current_user_dependency(services.auth_service)
    require_organizer = require_roles(get_current_user, UserRole.ORGANIZER)
    require_student = require_roles(get_current_user, UserRole.STUDENT)

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

    @router.get(
        "",
        response_model=RewardListResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": RewardErrorResponse},
            422: {"model": RewardErrorResponse},
        },
    )
    def list_rewards(
        page: int = Query(1, ge=1, description="1-based page number"),
        page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        """BE-58: rewards with whether the signed-in student is eligible,
        has already claimed, and what is still missing."""
        result = services.reward_service.list_rewards(
            current_user.user_id, page, page_size
        )
        return RewardListResponse(
            data=[_to_viewed_resource(view) for view in result.rewards],
            meta={"page": _page_meta(result)},
        )

    @router.get(
        "/{reward_id}",
        response_model=RewardResponse,
        response_model_exclude_none=True,
        responses={
            401: {"model": RewardErrorResponse},
            404: {"model": RewardErrorResponse},
        },
    )
    def get_reward(
        reward_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(get_current_user),
    ):
        try:
            view = services.reward_service.get_reward(reward_id, current_user.user_id)
        except RewardNotFoundError:
            return reward_not_found()
        return RewardResponse(data=_to_viewed_resource(view))

    @router.post(
        "/{reward_id}/claims",
        response_model=ClaimResponse,
        response_model_exclude_none=True,
        status_code=status.HTTP_201_CREATED,
        responses={
            401: {"model": RewardErrorResponse},
            403: {"model": RewardErrorResponse},
            404: {"model": RewardErrorResponse},
            409: {"model": RewardErrorResponse},
        },
    )
    def claim_reward(
        reward_id: int = Path(gt=0),
        current_user: CurrentUser = Depends(require_student),
    ):
        """BE-59: claim a reward. Eligibility is checked again on the server,
        and the claim and any points it spends commit together."""
        try:
            claim = services.reward_service.claim_reward(
                reward_id, current_user.user_id
            )
        except RewardNotFoundError:
            return reward_not_found()
        except RewardAlreadyClaimedError:
            return json_api_error_response(
                RewardErrorResponse,
                status.HTTP_409_CONFLICT,
                "reward_already_claimed",
                "Reward already claimed",
                "You have already claimed this reward.",
                "/reward_id",
            )
        except InsufficientPointsError as error:
            return json_api_error_response(
                RewardErrorResponse,
                status.HTTP_409_CONFLICT,
                "insufficient_points",
                "Not enough points",
                f"This reward costs {error.point_cost} points and you have "
                f"{error.available_points} to spend.",
                "/reward_id",
            )
        except RewardNotEligibleError as error:
            return json_api_error_response(
                RewardErrorResponse,
                status.HTTP_409_CONFLICT,
                "reward_not_eligible",
                "Not eligible for this reward",
                "Still needed: " + "; ".join(error.missing) + ".",
                "/reward_id",
            )
        return ClaimResponse(data=to_claim_resource(claim))

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


def to_claim_resource(claim: ClaimRecord) -> ClaimResourceData:
    return ClaimResourceData(
        id=str(claim.reward_claim_id),
        attributes=ClaimAttributes(
            reward_id=str(claim.reward_id),
            user_id=str(claim.user_id),
            points_spent=claim.points_spent,
            claimed_at=claim.claimed_at,
            available_points=claim.available_points,
        ),
    )


def _to_viewed_resource(view: RewardView) -> RewardResourceData:
    attributes = to_reward_attributes(view.reward)
    status_ = view.status
    attributes.viewer = RewardViewerStatus(
        eligible=status_.eligible,
        claimed=status_.claimed,
        missing=status_.missing,
        progress=RuleProgressAttributes(
            current=status_.progress.current, required=status_.progress.required
        ),
    )
    return RewardResourceData(id=str(view.reward.reward_id), attributes=attributes)


def _page_meta(result: RewardPage) -> dict:
    return {
        "number": result.page_number,
        "size": result.page_size,
        "total_items": result.total_items,
        "total_pages": result.total_pages,
    }


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
