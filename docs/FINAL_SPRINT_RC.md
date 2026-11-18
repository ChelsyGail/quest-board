# Final sprint release candidate

**Head:** `taha-final-sprint-integration` (this PR)  
**Base:** `ChelsyGail/quest-board` `main`  
**Final tip SHA:** `0b68a1a0a88ba1d92efa4ac84b3e68c5f4f0c2d8`  
**Dependency:** Incorporates Chelsy `last-sprint` / PR **#24** backend (proof → moderation → recognition → rewards, migrations `0010`–`0020`) onto our FE tip `faf4db1` (`taha-proof-backend-integration`). Do **not** also merge PR #24 into `main` after this lands, or backend will double-apply. Prefer closing #24 as superseded once this RC is accepted.

## Why not base on `last-sprint` alone

`last-sprint` is **25 ahead / 43 behind** `main` and ships accidental `.DS_Store` files. This RC cherry-picks the product files from `origin/last-sprint` @ `4b9de48` while keeping:

- Our FE contracts and UI (proof, moderation, rewards, loading/Grove prototype flags)
- Our `participation_service` leave-item / group cleanup + `current_submission_id` safeguards
- Our catalogue **instant** `window_start` / `window_end` filters (restored; last-sprint had dropped them) **plus** Chelsy’s `requires_*` proof flags on item attributes

## GitHub audit (rechecked after `git fetch`, 2026-11-18)

| Ref | vs `origin/main` | Notes |
|---|---|---|
| `fork/taha-proof-backend-integration` / `faf4db1` | **29 behind / 7 ahead** | Newer FE+proof work; no team PR |
| `origin/last-sprint` (PR #24) | **43 behind / 25 ahead** | Only open team PR |
| PR #24 reviews / checks | **0 reviews, 0 check runs** | REST: `review_comments=0`, check-runs `total=0` |
| `fork/main` | **69 behind / 0 ahead** | Stale fork default |
| Team PRs #1–#23 | merged | Some into stacked feature branches |

`.DS_Store` still present on `origin/last-sprint` tree (`.DS_Store`, `apps/.DS_Store`, `apps/backend/.DS_Store`). **Not** carried into this RC.

## Feature / ticket mapping (RC surface)

| Area | Tickets / work | Where |
|---|---|---|
| Proof upload + submit | QB-98/99 / Chelsy proof API | `proof_router`, `proof_service`, FE `proofs.js` |
| Proof requirements on quests | last-sprint `0010` | catalogue models/service/router + FE `requirementsFromItem` |
| Moderation queue / approve / reject | BE-5x / PR #24 | `review_router`, FE `ModeratorQueue.jsx` |
| Points / badges / achievements | recognition | `recognition_*`, `GET /users/me/achievements` |
| Rewards + claims | rewards | `reward_*`, FE `rewards.js` (`/claims`, no `/rewards/me`) |
| Auth media GET | PR #24 | `GET /media/{id}` + FE `hydrateMediaUrls` |
| Leave item / groups | prior integration | `participation_service` unchanged from `faf4db1` |
| Catalogue student TZ windows | our tip | `catalogue_router` window_start/end |
| Quest Grove / discussions | prototype only | `VITE_DISCUSSIONS_DEMO` — **no server persistence** |

## Verification (against local RC working tree; re-run after push for final SHA)

| Check | Result |
|---|---|
| Backend unit (`pytest tests/` without DB) | **20 passed, 11 skipped** |
| Backend integration (`QUESTBOARD_INTEGRATION=1`) | **11 passed** |
| FE focused proof/rewards (unit+live) | **19 passed** |
| FE full Vitest | **351–352 passed**; occasional flaky timeout in `CreateEvent.test.jsx` under full parallel load (passes alone) |
| `npm run build` | **passed** |
| Migrations `0010`–`0020` on `questboard_review` | **applied** (schema_migrations through `0020_unique_reward_claim.sql`) |
| Live API E2E | register → quest+requirements → publish → join → raw `POST /uploads` → submit → queue → approve → achievements (25 pts) → reward claim → `GET /media` → leave `204` — see `docs/evidence/api-e2e.txt` |
| Browser (Playwright against live flags) | Student quests board + Rewards (25 earned / 15 spendable, First Quest badge, claimed mug) — `docs/evidence/01-*.png`, `02-*.png`, `03-*.png` |

Live FE flags used for E2E (local `.env`, not committed):  
`VITE_QUESTS_DEMO=false`, `VITE_PROOFS_DEMO=false`, `VITE_PROOFS_API=true`, `VITE_MODERATION_API=true`, `VITE_REWARDS_DEMO=false`, `VITE_REWARDS_API=true`, `VITE_DISCUSSIONS_DEMO=true` (Grove prototype).

## Outstanding limitations

1. **Quest Grove / discussions** remain an in-browser demo — no discussion API, no durable spoiler ACL.
2. **PR #24** still open with DS_Store + no CI; coordinate close/supersede with Chelsy before dual-merge.
3. **Role elevation** for organizer/moderator in local E2E used DB role updates; production path is role-requests.
4. Full Vitest can flake one CreateEvent timing test under heavy parallel isolate; not RC-product regressions (focused suites green).
5. Antigravity / independent review must re-verify against the **final pushed SHA** — do not treat “everything reviewed” as true until findings are closed on that SHA.
6. Fork `main` remains 69 behind; use this branch tip, not fork main.

## Branch disposition (do **not** auto-delete)

| Branch | Verdict | Rationale |
|---|---|---|
| `taha-final-sprint-integration` | **retained** | RC head |
| `taha-proof-backend-integration` | **incorporated** | Tip `faf4db1` is the FE/proof base of this RC |
| `origin/last-sprint` / PR #24 | **retained until superseded** | Source of backend; close after RC accepted |
| `QB-49`, `QB-59`, `QB-61` | **safe to archive** | Unique tip commits are merge-only; empty diff vs merge-base with RC |
| `QB-71-BE-25-…` | **safe to archive** | Unique commit is pagination already present on catalogue service in lineage |
| `SCRUM-12`, `SCRUM-13` | **safe to archive** | No unique commits vs RC |
| `SCRUM-14` | **safe to archive** | Obsolete root `src/` stubs only |
| `SCRUM-15` | **safe to archive** | Obsolete React Native `apps/frontend` tree |
| Other merged `QB-*` / `SCRUM-*` tips | **safe to archive** after team confirms | Already merged via PRs #1–23 into stacked history |

## Grove remaining scope (explicit)

- Persist threads/replies server-side with authz.
- Spoiler / proof-gated visibility enforced by API, not sessionStorage.
- Replace `VITE_DISCUSSIONS_DEMO` once API exists; until then Grove stays labeled prototype.
