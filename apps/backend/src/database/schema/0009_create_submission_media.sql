-- Photo and video proof (BE-37). The bytes live in private object storage under
-- object_key; this row is what the API knows about them. An upload starts
-- unattached (submission_id NULL) and is attached when the student submits.
-- Uploads left unattached are cleaned up later (BE-43).
CREATE TABLE submission_media (
    media_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_id BIGINT UNSIGNED NOT NULL,
    submission_id BIGINT UNSIGNED NULL,
    content_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
    media_kind ENUM ('photo', 'video') NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    object_key VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    attached_at DATETIME(6) NULL,
    PRIMARY KEY (media_id),
    UNIQUE KEY unique_submission_media_object_key (object_key),
    KEY index_submission_media_submission (submission_id, media_id),
    KEY index_submission_media_owner (owner_id),
    CONSTRAINT fk_submission_media_owner FOREIGN KEY (owner_id) REFERENCES users (user_id),
    CONSTRAINT fk_submission_media_submission FOREIGN KEY (submission_id)
        REFERENCES submissions (submission_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
