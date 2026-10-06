ALTER TABLE users
    MODIFY roles SET ('student', 'organizer', 'moderator', 'admin') NOT NULL DEFAULT 'student';

CREATE TABLE role_requests (
    role_request_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    requested_role ENUM ('organizer', 'moderator') NOT NULL,
    reason VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
    status ENUM ('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    reviewed_by BIGINT UNSIGNED NULL,
    reviewed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    -- Only filled while the request is pending, so the unique key below allows
    -- one pending request per user and role but keeps any number of old ones.
    pending_role VARCHAR(16) GENERATED ALWAYS AS (IF(status = 'pending', requested_role, NULL)) STORED,
    PRIMARY KEY (role_request_id),
    UNIQUE KEY unique_role_requests_pending (user_id, pending_role),
    KEY index_role_requests_status (status),
    CONSTRAINT fk_role_requests_user FOREIGN KEY (user_id) REFERENCES users (user_id),
    CONSTRAINT fk_role_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
