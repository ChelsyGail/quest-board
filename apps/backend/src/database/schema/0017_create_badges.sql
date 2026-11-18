-- Badges and the awards that earn them (BE-56). A badge's criteria is one rule
-- (the same rule shapes rewards use): a number of approved quests, a number of
-- earned points, or a number of approved quests in one category. Criteria are
-- checked inside the approval transaction, and UNIQUE(user_id, badge_id) means
-- a student earns each badge at most once.
CREATE TABLE badges (
    badge_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    description VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    rule_type ENUM ('approved_quests', 'total_points', 'category_quests') NOT NULL,
    rule_threshold INT UNSIGNED NOT NULL,
    rule_category VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (badge_id),
    UNIQUE KEY unique_badges_name (name),
    CONSTRAINT check_badges_threshold CHECK (rule_threshold >= 1),
    CONSTRAINT check_badges_category
        CHECK ((rule_type = 'category_quests') = (rule_category IS NOT NULL))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- participation_id is the approval that earned the badge (NULL for badges
-- granted by the backfill below), so an approval retry can report them.
CREATE TABLE badge_awards (
    badge_award_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    badge_id BIGINT UNSIGNED NOT NULL,
    participation_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (badge_award_id),
    UNIQUE KEY unique_badge_awards_user_badge (user_id, badge_id),
    KEY index_badge_awards_participation (participation_id),
    CONSTRAINT fk_badge_awards_user FOREIGN KEY (user_id) REFERENCES users (user_id),
    CONSTRAINT fk_badge_awards_badge FOREIGN KEY (badge_id) REFERENCES badges (badge_id),
    CONSTRAINT fk_badge_awards_participation FOREIGN KEY (participation_id)
        REFERENCES participations (participation_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

INSERT INTO badges (name, description, rule_type, rule_threshold) VALUES
    ('First Quest', 'Completed a first quest.', 'approved_quests', 1),
    ('Explorer', 'Completed 5 quests.', 'approved_quests', 5),
    ('Pathfinder', 'Completed 10 quests.', 'approved_quests', 10),
    ('Century', 'Earned 100 points.', 'total_points', 100),
    ('High Achiever', 'Earned 500 points.', 'total_points', 500);

-- Students approved before badges existed get what they already qualify for.
INSERT INTO badge_awards (user_id, badge_id)
SELECT stats.user_id, b.badge_id
FROM (
    SELECT user_id, COUNT(*) AS approved_quests, SUM(points) AS total_points
    FROM point_awards
    GROUP BY user_id
) AS stats
JOIN badges AS b
    ON (b.rule_type = 'approved_quests' AND stats.approved_quests >= b.rule_threshold)
    OR (b.rule_type = 'total_points' AND stats.total_points >= b.rule_threshold);
