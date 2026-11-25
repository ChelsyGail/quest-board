# QuestBoard release candidate report

**Date:** 2026-11-25  
**Branch:** `taha-final-sprint-integration`  
**Product tip incorporated in team `main`:** `7744455cf5ae2281d43df665d28429024e360aab` (via merged PR **#25**)  
**Verification HEAD (this report):** run `git rev-parse HEAD` after the release-docs commit on this branch  
**Team base:** `ChelsyGail/quest-board` `main` (includes merge commit `2700dbe` for PR #25)  
**Prior independent review:** Antigravity accepted in-scope delivery on `7744455` (local summary under `.gemini/antigravity/brain/…/QUESTBOARD_REVIEW_SUMMARY.md`).  
**PR:** https://github.com/ChelsyGail/quest-board/pull/25 — **merged** into team `main` (do not re-merge). Follow-up docs/fix PR (if opened from this branch) is listed after push.

## Feature checklist

| Area | Status |
|---|---|
| Signup / login / logout / profile edit | **Verified live** |
| Role requests (create; non-admin list forbidden) | **Verified live** (admin decision path exists; local E2E also uses DB role elevation) |
| Organizer create / publish quest | **Verified live** |
| Discovery search / filters / pagination / detail | **Verified live** |
| Join + persistence after reload | **Verified live** |
| My Quests + calendar API (`/calendar?from&to`) | **Verified live** (browser List + Calendar controls present) |
| Proof upload (PNG), GIF reject, submit, history | **Verified live** |
| Private `GET /media/{id}` (owner yes / unrelated org 403) | **Verified live** |
| Pending + duplicate submit 409 | **Verified live** |
| Moderator queue / detail / reject / approve | **Verified live** |
| Resubmit after reject | **Verified live** |
| Self-review blocked (403) | **Verified live** |
| Points / badge once; approve replay no double points | **Verified live** |
| Reward create / claim / duplicate 409 / org claims list | **Verified live** |
| Leave blocked after proof (409) | **Verified live** |
| Quest workspace / loading-loop fixes preserved | **Present** (prior RC + Vitest) |
| Quest Grove / quest discussions | **Incomplete / deferred** — flags false; unavailable UI (copy clarified this turn) |
| Twists | **Incomplete** — `twist=None` |
| Demo sample mode (DEV + demo flags) | **Demo-only** — separate from live RC; not claimed as integration |

## Commands run (2026-11-25) and results

| Check | Result |
|---|---|
| `npx vitest run --maxWorkers=2` (apps/frontend) | **363 passed** (28 files) |
| Focused Vitest after Grove copy fix | **83 passed** |
| `npm run build` | **Passed** → `apps/frontend/dist/` |
| Backend unit (`pytest tests/ -q` via Poetry venv) | **24 passed, 11 skipped** |
| Backend + MySQL (`QUESTBOARD_INTEGRATION=1 pytest`) | **35 passed** |
| `git diff --check` (committed tree) | Clean at tip; Makefile WIP whitespace normalized before commit |
| `poetry run pre-commit` | **Not run** — `pre-commit` binary missing in this Poetry env |
| Live API journeys (student / organizer / moderator) | **Passed** (create→publish→join→proof→reject→resubmit→approve→points→reward claim; failure cases GIF/dup/self-review/leave) |
| Browser against `http://127.0.0.1:5173` + API `:8000` / DB `questboard_review` | Student catalogue (no demo banner), My Quests shows approved RC quest, Rewards shows 25/15 + claimed coffee, Grove **Coming soon** unavailable |

## Outstanding defects / dependency notes

1. **Grove/discussions deferred** — keep `VITE_DISCUSSIONS_DEMO=false` and `VITE_DISCUSSIONS_API=false`.
2. **Twists** unimplemented.
3. **Large HEIC / multi‑MB video** live boundary playback not re-exercised this session (stub PNG/MP4 paths covered previously + GIF reject today).
4. **Starlette deprecation warnings** (`HTTP_422_UNPROCESSABLE_ENTITY`, TestClient/httpx) — non-blocking.
5. **PR #24** historically superseded by this RC; do not dual-merge backend again.
6. Review DB still contains older E2E fixture titles — expected local residue; not wiped.

## Local startup (release / live)

```bash
# MySQL
cd .devcontainer && docker compose up -d mysql-db-service

# Migrations (idempotent)
cd apps/backend/src
set -a && . ../../../.devcontainer/.env && set +a
export MYSQL_HOST=127.0.0.1 MYSQL_DATABASE=questboard_review
poetry run python -m database.apply_schema

# API
export PROOF_MEDIA_DIR="$(pwd)/../var/proof-media"
poetry run uvicorn main:app --host 127.0.0.1 --port 8000

# Frontend (live flags in apps/frontend/.env — never commit secrets)
cd apps/frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

Live flag set: quests/proofs/moderation/rewards API on; both discussion flags off. See `apps/frontend/.env.example` and `docs/FINAL_SPRINT_RC.md`.

### Safe test-account setup

1. `POST /users` then `POST /auth/login` for student / organizer / moderator emails.
2. For local role elevation only: update `users.roles` in MySQL (`student,organizer` / `student,moderator`) — production path is `/role-requests`.
3. Do **not** commit passwords, tokens, or uploaded proof files.

## Hosting handoff

See **`docs/HOSTING_CHATGPT_SITES.md`**.

- **Option A (ready to prepare):** static `dist/` → externally hosted FastAPI/MySQL/media.
- **Option B (not Sites-ready yet):** DEV sample mode is not a production static demo; needs an explicit future demo build before claiming a self-contained Sites demo.

## Short demonstration walkthrough

1. Open http://127.0.0.1:5173/ and sign up / log in as a student.
2. Browse Quests (search/filter/pages); open a published quest; Join.
3. My Quests → confirm participation; optional Calendar toggle.
4. Submit proof (text + photo); see Pending; second submit blocked.
5. Log in as moderator → Proof review → Reject with feedback → student resubmits → Approve.
6. Student Rewards → points/badge → claim an eligible reward once.
7. Quest Grove shows **Coming soon** (deferred — not shared/live discussions).

## Honesty note

This RC is a **real integrated application** for the in-scope surface above. Grove sample/sessionStorage mode must not be described as shared functionality. Do not deploy from this report.
