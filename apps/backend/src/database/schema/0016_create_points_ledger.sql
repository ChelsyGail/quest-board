-- Points spent (BE-55). Earned points are never stored as a running total:
-- totalPoints is the sum of point_awards, and availablePoints is that sum minus
-- the committed debits recorded here. Claiming a reward adds a debit and never
-- touches point_awards, so spending points cannot erase what a student earned.
-- reward_claim_id gets its foreign key once reward_claims exists (BE-59).
CREATE TABLE points_ledger (
    ledger_entry_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    amount INT UNSIGNED NOT NULL,
    reason ENUM ('reward_claim') NOT NULL,
    reward_claim_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (ledger_entry_id),
    KEY index_points_ledger_user (user_id),
    CONSTRAINT check_points_ledger_amount CHECK (amount > 0),
    CONSTRAINT fk_points_ledger_user FOREIGN KEY (user_id) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
