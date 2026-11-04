CREATE TABLE participations (
    participation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    status ENUM ('joined', 'pending', 'rejected', 'approved') NOT NULL DEFAULT 'joined',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (participation_id),
    -- One participation per user and item (BE-28).
    UNIQUE KEY unique_participations_user_item (user_id, item_id),
    KEY index_participations_item (item_id, status),
    CONSTRAINT fk_participations_user FOREIGN KEY (user_id) REFERENCES users (user_id),
    CONSTRAINT fk_participations_item FOREIGN KEY (item_id) REFERENCES catalogue_items (item_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
