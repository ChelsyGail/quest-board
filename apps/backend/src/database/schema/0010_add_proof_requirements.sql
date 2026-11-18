-- What proof a quest asks for (BE-38). With both off, an attempt still needs
-- at least some text or one file (BE-37); turning one on makes it mandatory.
-- Events never take proof, so both stay FALSE on events.
ALTER TABLE catalogue_items
    ADD COLUMN requires_text_proof BOOLEAN NOT NULL DEFAULT FALSE AFTER proof_instructions,
    ADD COLUMN requires_media_proof BOOLEAN NOT NULL DEFAULT FALSE AFTER requires_text_proof;
