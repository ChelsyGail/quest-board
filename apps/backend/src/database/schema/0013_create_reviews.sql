-- A moderator's decision on one attempt (BE-46, BE-47). Rows are only ever
-- inserted. The one-final-review-per-attempt key arrives with BE-49.
CREATE TABLE reviews (
    review_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    submission_id BIGINT UNSIGNED NOT NULL,
    participation_id BIGINT UNSIGNED NOT NULL,
    reviewer_id BIGINT UNSIGNED NOT NULL,
    decision ENUM ('approved', 'rejected') NOT NULL,
    feedback TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (review_id),
    KEY index_reviews_submission (submission_id),
    KEY index_reviews_reviewer (reviewer_id),
    CONSTRAINT fk_reviews_submission FOREIGN KEY (submission_id)
        REFERENCES submissions (submission_id),
    CONSTRAINT fk_reviews_participation FOREIGN KEY (participation_id)
        REFERENCES participations (participation_id),
    CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
