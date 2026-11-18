from __future__ import annotations

from datetime import datetime
from typing import Annotated
from typing import Literal

from models.catalogue import ItemCategory
from models.recognition import RuleType
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator
from pydantic import StringConstraints

RewardName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
RewardDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]
PointCost = Annotated[int, Field(ge=0, le=100000)]
RuleThreshold = Annotated[int, Field(ge=1, le=1000000)]

# Which fields each rule type needs. Anything else must be left out.
RULE_FIELDS: dict[RuleType, frozenset[str]] = {
    RuleType.NONE: frozenset(),
    RuleType.APPROVED_QUESTS: frozenset({"threshold"}),
    RuleType.TOTAL_POINTS: frozenset({"threshold"}),
    RuleType.CATEGORY_QUESTS: frozenset({"threshold", "category"}),
    RuleType.QUEST_COMPLETED: frozenset({"quest_id"}),
}


class EligibilityRule(BaseModel):
    """Who may claim a reward (BE-62). For example
    {"type": "approved_quests", "threshold": 5} or
    {"type": "quest_completed", "quest_id": 12}."""

    model_config = ConfigDict(extra="forbid")

    type: RuleType
    threshold: RuleThreshold | None = None
    category: ItemCategory | None = None
    quest_id: Annotated[int, Field(gt=0)] | None = None

    @model_validator(mode="after")
    def require_rule_fields(self) -> EligibilityRule:
        needed = RULE_FIELDS[self.type]
        for field in ("threshold", "category", "quest_id"):
            present = getattr(self, field) is not None
            if field in needed and not present:
                raise ValueError(f"A {self.type.value} rule needs {field}.")
            if field not in needed and present:
                raise ValueError(f"A {self.type.value} rule does not take {field}.")
        return self


class RewardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: RewardName
    description: RewardDescription | None = None
    eligibility: EligibilityRule
    point_cost: PointCost = 0


class RewardUpdate(BaseModel):
    """Partial update. A new eligibility replaces the whole rule."""

    model_config = ConfigDict(extra="forbid")

    name: RewardName | None = None
    description: RewardDescription | None = None
    eligibility: EligibilityRule | None = None
    point_cost: PointCost | None = None

    @model_validator(mode="after")
    def require_change(self) -> RewardUpdate:
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change.")
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null.")
        return self


class EligibilityRuleAttributes(BaseModel):
    type: RuleType
    threshold: int | None = None
    category: str | None = None
    quest_id: str | None = None


class RuleProgressAttributes(BaseModel):
    current: int
    required: int


class RewardViewerStatus(BaseModel):
    """Where the signed-in student stands with this reward (BE-58)."""

    # True when the student can claim it right now: rule met, enough points,
    # and not claimed yet.
    eligible: bool
    claimed: bool
    # What is still needed, in words, e.g. "2 more approved quests". Empty
    # when eligible or already claimed.
    missing: list[str]
    progress: RuleProgressAttributes


class RewardAttributes(BaseModel):
    owner_id: str
    name: str
    description: str | None = None
    eligibility: EligibilityRuleAttributes
    point_cost: int
    created_at: datetime
    updated_at: datetime
    # Present on the student-facing list and detail (BE-58).
    viewer: RewardViewerStatus | None = None


class RewardResourceData(BaseModel):
    type: Literal["rewards"] = "rewards"
    id: str
    attributes: RewardAttributes


class ClaimAttributes(BaseModel):
    reward_id: str
    user_id: str
    # Who claimed it. On the organizer's claims list (BE-63).
    claimant_name: str | None = None
    # What the claim spent; 0 for a free reward.
    points_spent: int
    claimed_at: datetime
    # The claimant's spendable points right after the claim. Only on the
    # claim response itself.
    available_points: int | None = None


class ClaimResourceData(BaseModel):
    type: Literal["reward-claims"] = "reward-claims"
    id: str
    attributes: ClaimAttributes
