# Final sprint release candidate

**Head:** `taha-final-sprint-integration` (this PR)  
**Base:** `ChelsyGail/quest-board` `main`  
**Candidate SHA:** verify with `git rev-parse HEAD` after the S9 Antigravity-fixes commit (supersedes review of `359dd02`).  
**Prior reviewed SHA (Antigravity):** `359dd02fc8a72a42239581999df1b61cfe5363c0` — findings fixed in S9; retest the new tip only.  
**Feature commit (discussions/docs/proof controls):** `a258346aae550a3ad67b9427b4e59ae50eb6cb69`  
**Dependency:** Incorporates Chelsy `last-sprint` / PR **#24** backend (proof → moderation → recognition → rewards, migrations `0010`–`0020`) plus migration `0021` (discussions schema, **deferred acceptance**). Do **not** also merge PR #24 into `main` after this lands, or backend will double-apply. Prefer closing #24 as superseded once this RC is accepted.

## Why not base on `last-sprint` alone

`last-sprint` is **25 ahead / 43 behind** `main` and ships accidental `.DS_Store` files. This RC cherry-picks the product files from `origin/last-sprint` @ `4b9de48` while keeping:

- Our FE contracts and UI (proof, moderation, rewards, loading flags)
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

`.DS_Store` still present on `origin/last-sprint` tree. **Not** carried into this RC.

## Feature / ticket mapping (RC surface)

| Area | Tickets / work | Where | Acceptance |
|---|---|---|---|
| Proof upload + submit | QB-98/99 / Chelsy proof API | `proof_router`, `proof_service`, FE `proofs.js` | **In scope** |
| Proof requirements on quests | last-sprint `0010` + FE checkboxes | catalogue + `QuestForm` / `ItemForm` | **In scope** |
| Moderation queue / approve / reject | BE-5x / PR #24 | `review_router`, FE `ModeratorQueue.jsx` | **In scope** |
| Points / badges / achievements | recognition | `recognition_*`, `GET /users/me/achievements` | **In scope** |
| Rewards + claims | rewards | `reward_*`, FE `rewards.js` | **In scope** |
| Auth media GET | PR #24 | `GET /media/{id}` + FE `hydrateMediaUrls` | **In scope** |
| Leave item / groups | prior integration | `participation_service` | **In scope** (leave blocked after any proof) |
| Catalogue student TZ windows | our tip | `catalogue_router` window_start/end | **In scope** |
| Quest Grove / discussions | migration `0021` + `/discussions/*` + FE live client | `VITE_DISCUSSIONS_API=true` / `DEMO=false` for live verify | **In review on `taha-quest-grove`** — not merged/deployed yet |

## Grove / discussions — live gating

For live Grove + quest discussions:

```
VITE_DISCUSSIONS_DEMO=false
VITE_DISCUSSIONS_API=true
```

Keep both false only when deliberately hiding the feature. Sample demo (`DEMO=true`, DEV only) stays a separate mode and must not be enabled together with the API flag. Live mode never falls back to sessionStorage after an error.

## Verification (S9 — Antigravity findings fixed; supersedes S8 tip claims)

| Check | Result |
|---|---|
| Frontend Vitest (`--maxWorkers=2`) | **363 passed** |
| Backend pytest (unit + integration) | **35 passed** |
| `npm run build` | **passed** |
| Student Rewards + ModeratorQueue pagination | Prev/Next when `total_pages > 1` (`docs/evidence/s9-01`, `s9-05`, `s9-05b`) |
| Claim refresh | `GET /rewards/{id}` after claim (no first-100 search / synthetic fallback) |
| Uncertain resubmit reconcile | Requires newer submission id/attempt; upload-stage failures do not claim submit (`proofs.js` / `ProofSubmit.jsx` + tests) |
| Leave / Cancel RSVP UI | `DELETE /items/{id}/join` with confirm + 409 handling (`s9-02`) |
| Student submitted media preview | Authenticated blob `<img>` + “Photo or video Required” (`s9-03`) |
| Checkbox alignment / Makefile env load / pytest+httpx in Poetry dev | Fixed |
| Grove browser acceptance | **Deferred** — flags remain false |

S8 leave-after-proof API matrix remains valid (`docs/evidence/api-e2e-s8.txt`).

Live FE flags for in-scope RC:  
`VITE_QUESTS_DEMO=false`, `VITE_PROOFS_DEMO=false`, `VITE_PROOFS_API=true`, `VITE_MODERATION_API=true`, `VITE_REWARDS_DEMO=false`, `VITE_REWARDS_API=true`, `VITE_DISCUSSIONS_DEMO=false`, `VITE_DISCUSSIONS_API=false`.

## Outstanding limitations

1. **Quest Grove / discussions** — implemented but **deferred** for acceptance; keep flags false.
2. **Twists** — not implemented (`twist=None`); out of scope.
3. **PR #24** still open with DS_Store + no CI; coordinate close/supersede with Chelsy before dual-merge.
4. **Role elevation** for organizer/moderator in local E2E used DB role updates; production path is role-requests.
5. **Media durability** — documented `PROOF_MEDIA_DIR` + `make cleanup-uploads`; Compose `sleep infinity` is **not** tested durable storage. Deployments need a persistent volume (or object store) + scheduled cleanup. Cloud storage **not** introduced without demonstrated need.
6. **Not claimed verified this turn:** large-video/HEIC live playback, uncertain live reward-claim CDP abort, production multi-instance storage durability.
7. Antigravity / independent review must re-verify against the **exact new local candidate SHA** — prior review of `359dd02` does not sign off S9.
8. Fork remote may lag; use this branch tip, not fork `main`.

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

## Deferred Grove remaining scope (next week)

- Independent acceptance of persistent threads/replies with authz.
- Spoiler / proof-gated visibility browser matrix.
- Discussion reports/hide moderation (proposal MVP without reports).
- Decide whether to hide Grove nav when flags are off.
