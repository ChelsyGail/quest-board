# Proof submission and moderation API — proposal

**Status: proposal, not implemented on the backend.** No proof/submission tables or
routes exist in the current FastAPI app or on open teammate branches (verified
2026-11-12). The Sprint 5 frontend uses an explicit development mock when
`VITE_PROOFS_DEMO=true` on the Vite DEV server. Without that flag it shows that
proof review is not available yet. It never falls back to the mock after a live
request fails.

Jira mapping (frontend): QB-106–QB-112 (student), QB-123–QB-126 (moderator).
Backend tickets referenced by product: QB-98–QB-105 (proof), QB-113–QB-122
(moderation) — acceptance text was not readable from this environment.

## Resources

JSON:API. Bearer token required.

### Proof requirements (from the quest)

Derived from the published quest until a dedicated schema exists:

- `requires_text` (boolean)
- `requires_photo` / `requires_video` (boolean)
- `max_photos` (int, default 5)
- `max_photo_bytes` / `max_video_bytes`
- `allowed_photo_types` / `allowed_video_types` (MIME list)
- `instructions` (string; today’s `proof_instructions`)

### `GET /items/{item_id}/submissions/me`

The signed-in student’s latest submission for that quest (404 `submission_not_found`
if none). Attributes:

- `submission_id`, `item_id`, `status` (`pending` | `approved` | `rejected`)
- `text`, `photos[]` (`{ id, url, name, size }`), `video` or null
- `feedback` (moderator note; null until rejected/optionally approved)
- `submitted_at`, `reviewed_at`, `reviewer_id`

### `POST /items/{item_id}/submissions` (multipart)

Fields: `text`, `photos` (0..N files), `video` (optional file).

Rules:

- Caller must have participation `joined` (or resubmit after `rejected`).
- `409 already_submitted` if a `pending` or `approved` submission exists.
- `422` for missing required media/text or oversize/type violations.
- On success: participation status becomes `pending`; response is the submission.

### `GET /moderation/submissions?status=pending`

Moderator-only queue. Each item includes quest title, submitter name, submitted_at,
and requirement summary. `403` if the caller is not a moderator.

### `GET /moderation/submissions/{submission_id}`

Full detail including media URLs the moderator is authorized to fetch.

### `POST /moderation/submissions/{submission_id}/approve`

Empty body. Sets status `approved`, awards quest `point_value` via the points
service, sets participation to `approved`.  
`409 already_reviewed` if not pending.  
`403 cannot_review_own_submission` if the moderator is the submitter.

### `POST /moderation/submissions/{submission_id}/reject`

Body: `{ "feedback": "…" }` (required, trimmed, max 2000). Sets status `rejected`,
participation `rejected`. Same conflict/self-review rules as approve.

## Server checks required

- Role `moderator` for moderation routes (UI gating is not security).
- Membership/participation checks on submit and resubmit.
- Do not trust client-calculated points.
- Rate-limit uploads; scan/store media outside the DB as needed.
