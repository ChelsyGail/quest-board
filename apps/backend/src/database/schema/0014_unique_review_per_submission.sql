-- One final review per attempt (BE-49). The participation lock taken by the
-- approval and rejection transactions already turns a second decision away,
-- and this key is the database's own guarantee behind it. The unique key is
-- added before the old index is dropped, so the submission foreign key always
-- has an index to use.
ALTER TABLE reviews
    ADD UNIQUE KEY unique_reviews_submission (submission_id),
    DROP INDEX index_reviews_submission;
