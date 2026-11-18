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
from services.recognition_rules import evaluate
from services.recognition_rules import load_stats
from services.recognition_rules import RecognitionStats
from services.recognition_rules import Rule
from services.recognition_rules import RuleProgress
from services.recognition_service import load_balance
from services.recognition_service import PointBalance
from sqlalchemy import text
from utilities.settings import DatabaseSettings
from utilities.transactions import begin_read_committed
from utilities.transactions import with_deadlock_retry

logger = logging.getLogger(__name__)


class RewardNotFoundError(Exception):
    pass


class RewardOwnershipError(Exception):
    """Only the organizer who created a reward can change it."""


class InvalidRuleQuestError(Exception):
    """A quest_completed rule must name one of the organizer's own quests."""


class RewardNotEligibleError(Exception):
    """The student does not meet the reward's eligibility rule (BE-59)."""

    def __init__(self, missing: list[str]):
        super().__init__(missing)
        self.missing = missing


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


@dataclass(frozen=True)
class ClaimRecord:
    reward_claim_id: int
    reward_id: int
    user_id: int
    points_spent: int
    claimed_at: datetime
    available_points: int | None = None


@dataclass(frozen=True)
class RewardStatus:
    eligible: bool
    claimed: bool
    missing: list[str]
    progress: RuleProgress


@dataclass(frozen=True)
class RewardView:
    reward: RewardRecord
    status: RewardStatus


@dataclass(frozen=True)
class RewardPage:
    rewards: list[RewardView]
    page_number: int
    page_size: int
    total_items: int

    @property
    def total_pages(self) -> int:
        return -(-self.total_items // self.page_size)


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


def reward_status(
    reward: RewardRecord,
    stats: RecognitionStats,
    balance: PointBalance,
    claimed: bool,
) -> RewardStatus:
    """BE-58: eligible, claimed, and what is missing. The same check the claim
    transaction repeats under the per-user lock (BE-59)."""
    progress = evaluate(reward.rule, stats)
    missing = []
    if not claimed:
        if progress.missing:
            missing.append(progress.missing)
        short = reward.point_cost - balance.available_points
        if short > 0:
            noun = "point" if short == 1 else "points"
            missing.append(f"{short} more {noun} to spend")
    return RewardStatus(
        eligible=not claimed and not missing,
        claimed=claimed,
        missing=missing,
        progress=progress,
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

    def list_rewards(
        self, viewer_id: int, page_number: int, page_size: int
    ) -> RewardPage:
        """BE-58: every reward, newest first, each with the viewer's status."""
        with self.engine.connect() as connection:
            total_items = connection.execute(
                text("SELECT COUNT(*) FROM rewards")
            ).scalar_one()
            rows = connection.execute(
                text(
                    SELECT_REWARD_COLUMNS
                    + " ORDER BY created_at DESC, reward_id DESC"
                    + " LIMIT :limit OFFSET :offset"
                ),
                {"limit": page_size, "offset": (page_number - 1) * page_size},
            ).all()
            records = [reward_record_from_row(row) for row in rows]
            views = self._views(connection, viewer_id, records)
        return RewardPage(
            rewards=views,
            page_number=page_number,
            page_size=page_size,
            total_items=total_items,
        )

    def get_reward(self, reward_id: int, viewer_id: int) -> RewardView:
        with self.engine.connect() as connection:
            row = connection.execute(
                text(SELECT_REWARD_COLUMNS + " WHERE reward_id = :reward_id"),
                {"reward_id": reward_id},
            ).one_or_none()
            if row is None:
                raise RewardNotFoundError
            return self._views(connection, viewer_id, [reward_record_from_row(row)])[0]

    @staticmethod
    def _views(
        connection, viewer_id: int, records: list[RewardRecord]
    ) -> list[RewardView]:
        if not records:
            return []
        stats = load_stats(connection, viewer_id)
        balance = load_balance(connection, viewer_id)
        claimed_ids = _claimed_reward_ids(connection, viewer_id, records)
        return [
            RewardView(
                reward=record,
                status=reward_status(
                    record, stats, balance, record.reward_id in claimed_ids
                ),
            )
            for record in records
        ]

    def claim_reward(self, reward_id: int, user_id: int) -> ClaimRecord:
        """BE-59: recheck eligibility and record the claim and any points debit
        in one transaction. Retried a bounded number of times on a deadlock."""
        logger.info(
            "Claiming reward", extra={"reward_id": reward_id, "user_id": user_id}
        )
        return with_deadlock_retry(lambda: self._claim(reward_id, user_id))

    def _claim(self, reward_id: int, user_id: int) -> ClaimRecord:
        # READ COMMITTED (see utilities/transactions.py): every read below runs
        # after the per-user lock and sees what other claims and approvals for
        # this student have committed.
        with begin_read_committed(self.engine) as connection:
            # The per-user recognition lock, the same users row the approval
            # transaction locks last. Claims take it first and lock nothing
            # else for update, so the two cannot deadlock each other.
            connection.execute(
                text("SELECT user_id FROM users WHERE user_id = :user_id FOR UPDATE"),
                {"user_id": user_id},
            )
            row = connection.execute(
                text(SELECT_REWARD_COLUMNS + " WHERE reward_id = :reward_id FOR SHARE"),
                {"reward_id": reward_id},
            ).one_or_none()
            if row is None:
                raise RewardNotFoundError
            reward = reward_record_from_row(row)

            progress = evaluate(reward.rule, load_stats(connection, user_id))
            if not progress.met:
                logger.info(
                    "Claim refused, not eligible",
                    extra={"reward_id": reward_id, "user_id": user_id},
                )
                raise RewardNotEligibleError([progress.missing])

            claim_id = connection.execute(
                text(
                    """
                    INSERT INTO reward_claims (reward_id, user_id, points_spent)
                    VALUES (:reward_id, :user_id, :points_spent)
                    """
                ),
                {
                    "reward_id": reward_id,
                    "user_id": user_id,
                    "points_spent": reward.point_cost,
                },
            ).lastrowid
            if reward.point_cost > 0:
                connection.execute(
                    text(
                        """
                        INSERT INTO points_ledger
                            (user_id, amount, reason, reward_claim_id)
                        VALUES (:user_id, :amount, 'reward_claim', :claim_id)
                        """
                    ),
                    {
                        "user_id": user_id,
                        "amount": reward.point_cost,
                        "claim_id": claim_id,
                    },
                )
            claim_row = connection.execute(
                text("SELECT * FROM reward_claims WHERE reward_claim_id = :id"),
                {"id": claim_id},
            ).one()
            available = load_balance(connection, user_id).available_points

        logger.info(
            "Recorded reward claim",
            extra={
                "reward_claim_id": claim_id,
                "reward_id": reward_id,
                "user_id": user_id,
                "points_spent": reward.point_cost,
            },
        )
        return to_claim(claim_row, available)

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


def _claimed_reward_ids(
    connection, user_id: int, records: list[RewardRecord]
) -> set[int]:
    wanted = {record.reward_id for record in records}
    rows = connection.execute(
        text("SELECT reward_id FROM reward_claims WHERE user_id = :user_id"),
        {"user_id": user_id},
    ).all()
    return {row.reward_id for row in rows} & wanted


def to_claim(row, available_points: int | None = None) -> ClaimRecord:
    return ClaimRecord(
        reward_claim_id=row.reward_claim_id,
        reward_id=row.reward_id,
        user_id=row.user_id,
        points_spent=row.points_spent,
        claimed_at=from_utc_naive(row.created_at),
        available_points=available_points,
    )


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
