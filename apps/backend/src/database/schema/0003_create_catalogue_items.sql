CREATE TABLE catalogue_items (
    item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_id BIGINT UNSIGNED NOT NULL,
    kind ENUM ('event', 'quest') NOT NULL,
    title VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    description TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    location VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    -- Stored in UTC, with time_zone holding the IANA zone the item takes place in.
    starts_at DATETIME(6) NOT NULL,
    ends_at DATETIME(6) NOT NULL,
    time_zone VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    category VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    -- Quest-only fields, always NULL for events.
    proof_instructions TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
    point_value INT UNSIGNED NULL,
    status ENUM ('draft', 'published') NOT NULL DEFAULT 'draft',
    published_at DATETIME(6) NULL,
    archived_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (item_id),
    KEY index_catalogue_items_owner (owner_id),
    KEY index_catalogue_items_visible (status, archived_at, starts_at),
    KEY index_catalogue_items_category (category),
    KEY index_catalogue_items_kind (kind),
    CONSTRAINT fk_catalogue_items_owner FOREIGN KEY (owner_id) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
