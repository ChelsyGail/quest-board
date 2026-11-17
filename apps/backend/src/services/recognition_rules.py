"""The rule shapes behind badge criteria (BE-56) and, later, reward
eligibility: what a student has to have done, checked against their approved
quests and earned points. Everything is read from the database, never from
the client.
"""
from __future__ import annotations

from dataclasses import dataclass

from models.recognition import RuleType
from sqlalchemy import text


@dataclass(frozen=True)
class Rule:
    type: RuleType
    threshold: int | None = None
    category: str | None = None


@dataclass(frozen=True)
class RecognitionStats:
    approved_quests: int
    total_points: int
    # Approved quests per category, keyed by casefolded category name, matching
    # the case- and accent-insensitive collation the category column uses.
    quests_by_category: dict[str, int]


@dataclass(frozen=True)
class RuleProgress:
    met: bool
    current: int
    required: int
    # What is still needed, in words, or None once the rule is met.
    missing: str | None


def load_stats(connection, user_id: int) -> RecognitionStats:
    """One row per point award, i.e. per approved quest (BE-54)."""
    rows = connection.execute(
        text(
            """
            SELECT pa.points, i.category
            FROM point_awards AS pa
            JOIN catalogue_items AS i ON i.item_id = pa.item_id
            WHERE pa.user_id = :user_id
            """
        ),
        {"user_id": user_id},
    ).all()
    by_category: dict[str, int] = {}
    for row in rows:
        key = row.category.casefold()
        by_category[key] = by_category.get(key, 0) + 1
    return RecognitionStats(
        approved_quests=len(rows),
        total_points=sum(row.points for row in rows),
        quests_by_category=by_category,
    )


def evaluate(rule: Rule, stats: RecognitionStats) -> RuleProgress:
    if rule.type == RuleType.APPROVED_QUESTS:
        return _progress(
            stats.approved_quests, rule.threshold, "approved quest", "approved quests"
        )
    if rule.type == RuleType.TOTAL_POINTS:
        return _progress(stats.total_points, rule.threshold, "point", "points")
    if rule.type == RuleType.CATEGORY_QUESTS:
        current = stats.quests_by_category.get(rule.category.casefold(), 0)
        return _progress(
            current,
            rule.threshold,
            f"approved quest in {rule.category}",
            f"approved quests in {rule.category}",
        )
    raise ValueError(f"Unknown rule type {rule.type}")


def _progress(current: int, required: int, one: str, many: str) -> RuleProgress:
    """One message shape for every count rule: "3 more approved quests"."""
    if current >= required:
        return RuleProgress(met=True, current=current, required=required, missing=None)
    short = required - current
    noun = one if short == 1 else many
    return RuleProgress(
        met=False, current=current, required=required, missing=f"{short} more {noun}"
    )
