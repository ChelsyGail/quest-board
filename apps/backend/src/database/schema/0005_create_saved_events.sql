-- BE-30: items a student has saved without joining, so they still get reminders.
-- The SRS and the C4 document call this saved_events; it holds saved quests too.
CREATE TABLE saved_events (
    user_id BIGINT UNSIGNED NOT NULL,
    item_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- One row per student and item: saving something twice is a no-op, and the
    -- first save keeps its created_at.
    PRIMARY KEY (user_id, item_id),
    KEY index_saved_events_item (item_id),
    CONSTRAINT fk_saved_events_user FOREIGN KEY (user_id) REFERENCES users (user_id),
    CONSTRAINT fk_saved_events_item FOREIGN KEY (item_id) REFERENCES catalogue_items (item_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
