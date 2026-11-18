"""Rewards (C3 Recognition): what organizers offer and who may claim it."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from database.connection import create_database_engine
from models.catalogue import ItemKind
from models.recognition import RuleType
from models.reward import EligibilityRule
from models.reward import RewardCreate
from models.reward import RewardUpdate
from services.catalogue_service import from_utc_naive
from services.recognition_rules import Rule
from sqlalchemy import text
from utilities.settings import DatabaseSettings

logger = logging.getLogger(__name__)


class RewardNotFoundError(Exception):
    pass


class RewardOwnershipError(Exception):
    """Only the organizer who created a reward can change it."""


class InvalidRuleQuestError(Exception):
    """A quest_completed rule must name one of the organizer's own quests."""


@dataclass(frozen=True)
class RewardRecord:
    reward_id: int
    owner_id: int
    name: str
    description: str | None
    rule: Rule
    point_cost: int
    created_at: datetime
    updated_at: datetime


SELECT_REWARD_COLUMNS = """
    SELECT reward_id, owner_id, name, description, rule_type, rule_threshold,
           rule_category, rule_item_id, point_cost, created_at, updated_at
    FROM rewards
"""


def to_rule(eligibility: EligibilityRule) -> Rule:
    return Rule(
        type=eligibility.type,
        threshold=eligibility.threshold,
        category=eligibility.category,
        item_id=eligibility.quest_id,
    )


def reward_record_from_row(row) -> RewardRecord:
    return RewardRecord(
        reward_id=row.reward_id,
        owner_id=row.owner_id,
        name=row.name,
        description=row.description,
        rule=Rule(
            type=RuleType(row.rule_type),
            threshold=row.rule_threshold,
            category=row.rule_category,
            item_id=row.rule_item_id,
        ),
        point_cost=row.point_cost,
        created_at=from_utc_naive(row.created_at),
        updated_at=from_utc_naive(row.updated_at),
    )


def _rule_columns(rule: Rule) -> dict:
    return {
        "rule_type": rule.type.value,
        "rule_threshold": rule.threshold,
        "rule_category": rule.category,
        "rule_item_id": rule.item_id,
    }


class RewardService:
    def __init__(self, settings: DatabaseSettings):
        self.engine = create_database_engine(settings)

    def create_reward(self, owner_id: int, reward: RewardCreate) -> RewardRecord:
        """BE-62: organizer only (checked by the router), with a name, an
        eligibility rule and an optional point cost."""
        rule = to_rule(reward.eligibility)
        with self.engine.begin() as connection:
            _check_rule_quest(connection, rule, owner_id)
            result = connection.execute(
                text(
                    """
                    INSERT INTO rewards
                        (owner_id, name, description, rule_type, rule_threshold,
                         rule_category, rule_item_id, point_cost)
                    VALUES
                        (:owner_id, :name, :description, :rule_type, :rule_threshold,
                         :rule_category, :rule_item_id, :point_cost)
                    """
                ),
                {
                    "owner_id": owner_id,
                    "name": reward.name,
                    "description": reward.description,
                    "point_cost": reward.point_cost,
                    **_rule_columns(rule),
                },
            )
            row = _load_reward(connection, result.lastrowid)
        logger.info(
            "Created reward",
            extra={"reward_id": row.reward_id, "owner_id": owner_id},
        )
        return reward_record_from_row(row)

    def update_reward(
        self, reward_id: int, actor_id: int, update: RewardUpdate
    ) -> RewardRecord:
        """BE-62: only the reward's owner can change it. Claims already made
        stay as they are when the rule or the cost changes."""
        changes = {}
        if update.name is not None:
            changes["name"] = update.name
        if update.description is not None:
            changes["description"] = update.description
        if update.point_cost is not None:
            changes["point_cost"] = update.point_cost
        rule = to_rule(update.eligibility) if update.eligibility else None
        if rule is not None:
            changes.update(_rule_columns(rule))

        with self.engine.begin() as connection:
            row = connection.execute(
                text(
                    SELECT_REWARD_COLUMNS + " WHERE reward_id = :reward_id FOR UPDATE"
                ),
                {"reward_id": reward_id},
            ).one_or_none()
            if row is None:
                raise RewardNotFoundError
            if row.owner_id != actor_id:
                logger.warning(
                    "Rejected change to another organizer's reward",
                    extra={"reward_id": reward_id, "actor_id": actor_id},
                )
                raise RewardOwnershipError
            if rule is not None:
                _check_rule_quest(connection, rule, actor_id)

            assignments = ", ".join(f"{field} = :{field}" for field in changes)
            connection.execute(
                text(
                    "UPDATE rewards SET "
                    + assignments
                    + ", updated_at = CURRENT_TIMESTAMP(6)"
                    + " WHERE reward_id = :reward_id"
                ),
                {**changes, "reward_id": reward_id},
            )
            row = _load_reward(connection, reward_id)
        logger.info(
            "Updated reward",
            extra={"reward_id": reward_id, "fields": sorted(changes)},
        )
        return reward_record_from_row(row)


def _load_reward(connection, reward_id: int):
    return connection.execute(
        text(SELECT_REWARD_COLUMNS + " WHERE reward_id = :reward_id"),
        {"reward_id": reward_id},
    ).one()


def _check_rule_quest(connection, rule: Rule, owner_id: int) -> None:
    if rule.type != RuleType.QUEST_COMPLETED:
        return
    item = connection.execute(
        text("SELECT owner_id, kind FROM catalogue_items WHERE item_id = :item_id"),
        {"item_id": rule.item_id},
    ).one_or_none()
    if item is None or item.kind != ItemKind.QUEST.value or item.owner_id != owner_id:
        raise InvalidRuleQuestError
