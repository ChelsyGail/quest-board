-- One claim per student and reward (BE-60). The claim transaction checks for
-- an earlier claim under the per-user lock, and this key backs that check up.
-- The new key starts with user_id, so it replaces the plain user index the
-- user foreign key was using.
ALTER TABLE reward_claims
    ADD UNIQUE KEY unique_reward_claims_user_reward (user_id, reward_id),
    DROP INDEX index_reward_claims_user;
