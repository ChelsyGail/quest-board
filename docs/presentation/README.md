# QuestBoard local presentation demo

Dedicated local database and media tree for campus screenshots and walkthroughs. Does **not** use mock catalogue data.

## Targets

| Piece | Value |
|---|---|
| App | http://localhost:5173/ |
| API | http://localhost:8000/ |
| Database | `questboard_presentation` only |
| Media | `apps/backend/var/proof-media-presentation` |

Other local databases (`questboard_review`, `questboard_antigravity_*`) are left untouched.

## Accounts

Credentials live in **`ACCOUNTS.local.md`** (gitignored). Do not commit passwords.

## Start stack (local helper)

Gitignored helper (copy/keep local):

```bash
bash docs/presentation/start-demo.local.sh
```

Forces `MYSQL_DATABASE=questboard_presentation` and `PROOF_MEDIA_DIR=…/proof-media-presentation`.

## Seed (opt-in)

Guarded job: `apps/backend/src/jobs/seed_presentation.py`

- Requires `MYSQL_DATABASE=questboard_presentation`
- Requires `--i-understand-this-targets-presentation-only`
- Uses live HTTP API paths (create/publish/join/submit/review/claim)

```bash
export PRESENTATION_PASSWORD='…'   # from ACCOUNTS.local.md
make presentation-seed
# or:
export MYSQL_DATABASE=questboard_presentation
export PRESENTATION_API_BASE=http://127.0.0.1:8000
cd apps/backend/src
python -m jobs.seed_presentation --i-understand-this-targets-presentation-only
```

Clean restore (presentation DB only):

```bash
PRESENTATION_PASSWORD='…' make presentation-restore
# or:
python -m jobs.seed_presentation --i-understand-this-targets-presentation-only \
  --wipe-presentation-data-first
```

## Frontend flags

Live proofs/rewards/moderation; Grove deferred:

- `VITE_QUESTS_DEMO=false`
- `VITE_PROOFS_DEMO=false` / `VITE_PROOFS_API=true`
- `VITE_REWARDS_DEMO=false` / `VITE_REWARDS_API=true`
- `VITE_MODERATION_API=true`
- `VITE_DISCUSSIONS_DEMO=false` / `VITE_DISCUSSIONS_API=false`

## Local screenshots

Gitignored captures under `docs/presentation/screenshots/` (regenerate anytime from the live demo):

| File | Screen |
|---|---|
| `01-catalogue-organiser.png` | Organiser catalogue |
| `02-organiser-my-items.png` | Organiser My items |
| `03-organiser-claims-maya.png` | Organiser Claims (Maya) |
| `04-login.png` | Login |
| `05-catalogue-student.png` | Student catalogue |
| `06-my-quests.png` | My Quests |
| `07-rewards-student.png` | Student Rewards (points/badge) |
| `08-greenhouse-join-ready.png` | Fresh Greenhouse join |
| `09-moderator-queue.png` | Moderator Proof review |
