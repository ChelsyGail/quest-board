-- BE-34: students taking on a quest together. Proof and awards stay per student
-- in this first version, so a group is a social arrangement, not a shared attempt.
CREATE TABLE quest_groups (
    group_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    item_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (group_id),
    -- Two groups on the same quest cannot share a name.
    UNIQUE KEY unique_quest_groups_name (item_id, name),
    -- Lets group_members reference (group_id, item_id), so a member's quest and
    -- their group's quest can never drift apart.
    UNIQUE KEY unique_quest_groups_identity (group_id, item_id),
    CONSTRAINT fk_quest_groups_item FOREIGN KEY (item_id) REFERENCES catalogue_items (item_id),
    CONSTRAINT fk_quest_groups_creator FOREIGN KEY (created_by) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE group_members (
    group_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (group_id, user_id),
    -- One group per student per quest.
    UNIQUE KEY unique_group_members_quest (item_id, user_id),
    KEY index_group_members_user (user_id),
    CONSTRAINT fk_group_members_group FOREIGN KEY (group_id, item_id)
        REFERENCES quest_groups (group_id, item_id) ON DELETE CASCADE,
    CONSTRAINT fk_group_members_user FOREIGN KEY (user_id) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
