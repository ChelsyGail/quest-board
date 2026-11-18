-- Reward claims (BE-59). A claim and its points debit are written in one
-- transaction, so points_ledger now points at the claim it pays for. Rows are
-- only ever inserted: the claims are also the audit record of redemptions.
CREATE TABLE reward_claims (
    reward_claim_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reward_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    -- The reward's point_cost when the claim committed (a snapshot).
    points_spent INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (reward_claim_id),
    KEY index_reward_claims_user (user_id),
    KEY index_reward_claims_reward (reward_id, created_at),
    CONSTRAINT fk_reward_claims_reward FOREIGN KEY (reward_id)
        REFERENCES rewards (reward_id),
    CONSTRAINT fk_reward_claims_user FOREIGN KEY (user_id) REFERENCES users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

ALTER TABLE points_ledger
    ADD UNIQUE KEY unique_points_ledger_claim (reward_claim_id),
    ADD CONSTRAINT fk_points_ledger_claim FOREIGN KEY (reward_claim_id)
        REFERENCES reward_claims (reward_claim_id);
