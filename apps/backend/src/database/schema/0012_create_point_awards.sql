-- Points earned for an approved quest (BE-54). `points` is copied from the
-- quest when the approval commits, so an organizer changing point_value later
-- never rewrites what students already earned. UNIQUE(participation_id) is the
-- final guard against awarding the same completion twice.
CREATE TABLE point_awards (
    point_award_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    participation_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    points INT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (point_award_id),
    UNIQUE KEY unique_point_awards_participation (participation_id),
    KEY index_point_awards_user (user_id),
    CONSTRAINT fk_point_awards_participation FOREIGN KEY (participation_id)
        REFERENCES participations (participation_id),
    CONSTRAINT fk_point_awards_user FOREIGN KEY (user_id) REFERENCES users (user_id),
    CONSTRAINT fk_point_awards_item FOREIGN KEY (item_id)
        REFERENCES catalogue_items (item_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
