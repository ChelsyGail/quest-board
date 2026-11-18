-- The moderation queue (BE-44) reads every Pending participation, oldest
-- attempt first; this keeps that a range scan instead of a full table scan.
ALTER TABLE participations
    ADD KEY index_participations_status (status, current_submission_id);
