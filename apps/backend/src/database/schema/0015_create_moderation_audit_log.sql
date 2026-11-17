-- Audit record of every moderation decision (BE-52), written in the same
-- transaction as the review. The application only ever inserts here: no code
-- path updates or deletes a row, and the rows stay when a quest is archived.
-- Reviews that already exist are copied in, so the log starts complete.
CREATE TABLE moderation_audit_log (
    audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    review_id BIGINT UNSIGNED NOT NULL,
    submission_id BIGINT UNSIGNED NOT NULL,
    participation_id BIGINT UNSIGNED NOT NULL,
    student_id BIGINT UNSIGNED NOT NULL,
    reviewer_id BIGINT UNSIGNED NOT NULL,
    decision ENUM ('approved', 'rejected') NOT NULL,
    feedback TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
    points_awarded INT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (audit_id),
    UNIQUE KEY unique_moderation_audit_review (review_id),
    KEY index_moderation_audit_submission (submission_id),
    KEY index_moderation_audit_reviewer (reviewer_id, created_at),
    KEY index_moderation_audit_student (student_id, created_at),
    CONSTRAINT fk_moderation_audit_review FOREIGN KEY (review_id)
        REFERENCES reviews (review_id),
    CONSTRAINT fk_moderation_audit_submission FOREIGN KEY (submission_id)
        REFERENCES submissions (submission_id),
    CONSTRAINT fk_moderation_audit_participation FOREIGN KEY (participation_id)
        REFERENCES participations (participation_id),
    CONSTRAINT fk_moderation_audit_student FOREIGN KEY (student_id)
        REFERENCES users (user_id),
    CONSTRAINT fk_moderation_audit_reviewer FOREIGN KEY (reviewer_id)
        REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

INSERT INTO moderation_audit_log
    (review_id, submission_id, participation_id, student_id, reviewer_id,
     decision, feedback, points_awarded, created_at)
SELECT r.review_id, r.submission_id, r.participation_id, p.user_id, r.reviewer_id,
       r.decision, r.feedback,
       CASE WHEN r.decision = 'approved' THEN pa.points END,
       r.created_at
FROM reviews AS r
JOIN participations AS p ON p.participation_id = r.participation_id
LEFT JOIN point_awards AS pa ON pa.participation_id = r.participation_id
ORDER BY r.review_id;
