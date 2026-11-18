-- Rewards an organizer offers (BE-62). The eligibility rule uses the same
-- shapes as badge criteria, plus 'none' (anyone may claim) and
-- 'quest_completed' (one of the organizer's own quests must be approved).
-- point_cost is what a claim spends from availablePoints, 0 for a free reward.
CREATE TABLE rewards (
    reward_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    description TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
    rule_type ENUM (
        'none', 'approved_quests', 'total_points', 'category_quests', 'quest_completed'
    ) NOT NULL,
    rule_threshold INT UNSIGNED NULL,
    rule_category VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
    rule_item_id BIGINT UNSIGNED NULL,
    point_cost INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (reward_id),
    KEY index_rewards_owner (owner_id),
    KEY index_rewards_created (created_at, reward_id),
    CONSTRAINT fk_rewards_owner FOREIGN KEY (owner_id) REFERENCES users (user_id),
    CONSTRAINT fk_rewards_rule_item FOREIGN KEY (rule_item_id)
        REFERENCES catalogue_items (item_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
