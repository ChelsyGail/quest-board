-- BE-33: whether a student appears by name in attendee lists (BE-32).
-- Default 'visible': the "who is attending" feature the survey asked for only
-- helps if most students appear in it. The SRS leaves the default open, so
-- confirm this before launch (Product decisions, C4 document).
ALTER TABLE users
    ADD COLUMN attendance_visibility ENUM ('visible', 'hidden') NOT NULL DEFAULT 'visible' AFTER roles;
