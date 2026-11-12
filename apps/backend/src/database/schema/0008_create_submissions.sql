-- Proof submissions (BE-36). Each row is one attempt on one participation; a
-- rejected participation gets a new attempt rather than an edited one (BE-41),
-- so attempt_number counts up per participation and old attempts are kept.
CREATE TABLE submissions (
    submission_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    participation_id BIGINT UNSIGNED NOT NULL,
    attempt_number INT UNSIGNED NOT NULL,
    text_proof TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (submission_id),
    UNIQUE KEY unique_submissions_attempt (participation_id, attempt_number),
    KEY index_submissions_created (created_at, submission_id),
    CONSTRAINT fk_submissions_participation FOREIGN KEY (participation_id)
        REFERENCES participations (participation_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- The attempt a moderator is looking at. Locking the participation row with
-- SELECT ... FOR UPDATE therefore also pins down which submission is current
-- (BE-46), and the moderation queue joins on it (BE-44).
ALTER TABLE participations
    ADD COLUMN current_submission_id BIGINT UNSIGNED NULL AFTER status,
    ADD CONSTRAINT fk_participations_current_submission
        FOREIGN KEY (current_submission_id) REFERENCES submissions (submission_id);
