# Achievements and rewards API — proposal

**Status: proposal, not implemented on the backend.** No points, badge or reward
tables/routes exist in the current app (verified 2026-11-12). The Sprint 5
frontend uses an explicit development mock when `VITE_REWARDS_DEMO=true` on the
Vite DEV server. Without that flag the profile/rewards screens say rewards are
not available yet. Balances and eligibility are never calculated authoritatively
in the browser when a live API is used.

Jira mapping (frontend): QB-137–QB-141. Backend tickets referenced by product:
QB-127–QB-136 — acceptance text was not readable from this environment.

## `GET /me/achievements`

Returns:

- `earned_points` (lifetime; increased when a submission is approved)
- `spendable_points` (earned minus claimed rewards)
- `badges[]`: `{ id, name, description, earned_at }`

## `GET /rewards`

Published rewards. Each:

- `id`, `title`, `description`, `cost_points`, `requirements` (text)
- `eligibility`: `eligible` | `insufficient_points` | `requirements_unmet` | `claimed` | `unavailable`
- `claimed` (boolean for the current user)

Eligibility is decided **only** by the server.

## `POST /rewards/{reward_id}/claim`

Empty body. On success returns updated `{ reward, achievements }`.  
Errors: `409 already_claimed`, `422 not_eligible`, `403` as appropriate.

## Organizer

### `POST /rewards`

Body: title, description, cost_points, requirements, optional stock. Organizer-only.
Creates a draft or published reward per backend rules (frontend sends published
intent when the mock is used).

### `GET /rewards/me`

Organizer’s own rewards.

### `GET /rewards/{reward_id}/claims`

Who claimed it: `{ user_id, name, claimed_at }[]`. Owner-only.

## Server checks required

- Award points only from moderated approvals (or other trusted events).
- Claim must re-check balance and eligibility in a transaction.
- Organizer ownership on create/claims list.
