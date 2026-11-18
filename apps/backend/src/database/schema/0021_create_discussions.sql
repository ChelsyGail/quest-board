CREATE TABLE discussion_threads (
    thread_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    scope VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    item_id BIGINT UNSIGNED NULL,
    title VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    category VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    body TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    author_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (thread_id),
    KEY index_discussion_threads_scope (scope, deleted_at, created_at),
    KEY index_discussion_threads_item (item_id, scope, deleted_at),
    CONSTRAINT fk_discussion_threads_author FOREIGN KEY (author_user_id) REFERENCES users (user_id),
    CONSTRAINT fk_discussion_threads_item FOREIGN KEY (item_id) REFERENCES catalogue_items (item_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE discussion_replies (
    reply_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    thread_id BIGINT UNSIGNED NOT NULL,
    body TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    author_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (reply_id),
    KEY index_discussion_replies_thread (thread_id, deleted_at, created_at),
    CONSTRAINT fk_discussion_replies_thread FOREIGN KEY (thread_id) REFERENCES discussion_threads (thread_id),
    CONSTRAINT fk_discussion_replies_author FOREIGN KEY (author_user_id) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;