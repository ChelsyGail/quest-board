# QuestBoard

Campus quests and events noticeboard: React (Vite) frontend + FastAPI/MySQL backend.

## Layout

```
apps/frontend/     React 19 + Vite 8 UI
apps/backend/      FastAPI API (`src/`), Poetry project, SQL migrations
.devcontainer/     Local MySQL + optional Python container (Compose)
docs/              Proposals, RC notes, evidence
```

## Prerequisites

- Node.js 20+ and npm
- Python 3.12+ and Poetry
- Docker Desktop (for MySQL via Compose)
- Copy env from examples (never commit real `.env` files)

## Database (local)

Compose file: `.devcontainer/docker-compose.yml` (MySQL on host port `3306`).

```bash
cd .devcontainer
# Credentials come from .devcontainer/.env (create from team defaults; not committed)
docker compose up -d mysql-db-service
```

Apply schema migrations (idempotent; safe on existing review DBs):

```bash
cd apps/backend/src
set -a && . ../../../.devcontainer/.env && set +a
export MYSQL_HOST=127.0.0.1 MYSQL_DATABASE=questboard_review   # or your DB name
poetry run python -m database.apply_schema
```

Migrations live in `apps/backend/src/database/schema/` (`0001`…`0021_create_discussions.sql`).

## Backend

```bash
cd apps/backend
poetry install
cd src
set -a && . ../../../.devcontainer/.env && set +a
export MYSQL_HOST=127.0.0.1 MYSQL_DATABASE=questboard_review
poetry run uvicorn main:app --host 127.0.0.1 --port 8000
```

Health: `GET http://127.0.0.1:8000/health`  
OpenAPI: `http://127.0.0.1:8000/docs`

### Proof media and upload cleanup

| Variable | Purpose | Default |
|---|---|---|
| `PROOF_MEDIA_DIR` | Directory for private proof blobs (local object store) | `apps/backend/var/proof-media` |
| `UPLOAD_ABANDON_AFTER_HOURS` | Age after which unattached uploads are deleted | `24` |

Documented in `apps/backend/.env.example`. The `var/` tree is gitignored.

Delete abandoned uploads (BE-43):

```bash
make cleanup-uploads
# Loads .devcontainer/.env (required) so MYSQL_* / PROOF_MEDIA_DIR are explicit.
# Or: cd apps/backend/src && set -a && . ../../../.devcontainer/.env && set +a \
#      && poetry run python -m jobs.cleanup_uploads
```

`make db-schema` and `make cleanup-uploads` refuse to run without `.devcontainer/.env` (or an alternate path via `DEVCONTAINER_ENV=...`) so they do not silently target an unintended database.

### Durable private media (deployment note)

Dev Compose runs `python-api-service` with `command: sleep infinity` and a **workspace bind mount**. That is for interactive coding only — it is **not** production storage.

For a real deployment:

1. Set `PROOF_MEDIA_DIR` to a **persistent volume** (or replace `LocalObjectStore` with object storage such as S3).
2. Serve media only through authenticated `GET /media/{id}` (never a public static path).
3. Schedule `make cleanup-uploads` (cron/worker) using `UPLOAD_ABANDON_AFTER_HOURS`.
4. Do not rely on the Compose bind mount or `sleep infinity` container as the media durability story.

## Frontend

```bash
cd apps/frontend
cp .env.example .env   # then edit flags
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

`VITE_API_BASE_URL` is the backend **origin** (no `/api/v1` path suffix).

### Demo vs live flags

Never enable demo and live for the same feature. Live mode must not fall back to demo after a failure.

| Flag | Role |
|---|---|
| `VITE_QUESTS_DEMO` / `VITE_QUESTS_ENABLED` | Catalogue demo vs API |
| `VITE_PROOFS_DEMO` / `VITE_PROOFS_API` | Student proof |
| `VITE_MODERATION_API` | Moderator queue (needs review routes) |
| `VITE_REWARDS_DEMO` / `VITE_REWARDS_API` | Achievements / rewards |
| `VITE_DISCUSSIONS_DEMO` / `VITE_DISCUSSIONS_API` | Grove + quest discussions (**deferred** for this RC) |

Live RC example: quests/proofs/moderation/rewards API on; **both** discussion flags **false** so Grove/quest discussions show unavailable. Migration `0021` + routes remain in the tree but are **not independently accepted** until next week — keep flags off for release.

## Testing

```bash
# Frontend
cd apps/frontend && npm test -- --run
cd apps/frontend && npm run build

# Backend unit (no DB) — install the Poetry dev group first (pytest, httpx)
cd apps/backend && poetry install --with dev
poetry run pytest tests/ -q

# Backend integration (MySQL up; load .devcontainer/.env so the DB is explicit)
cd apps/backend && set -a && . ../../.devcontainer/.env && set +a
export QUESTBOARD_INTEGRATION=1 MYSQL_HOST=127.0.0.1 MYSQL_DATABASE=questboard_review
poetry run pytest tests/ -q
```

## Twists

Participation/review payloads may expose a `twist` field. **Twists (BE-26/BE-29) are not implemented** — the API currently returns `twist=None`. Do not treat twists as done.

## Docs

- `docs/FINAL_SPRINT_RC.md` — release-candidate notes
- `docs/discussion-api-proposal.md` — discussion scopes (partially implemented)
- `docs/evidence/` — local verification artifacts (may be regenerated; avoid committing secrets)

## Classroom demo (ChatGPT Sites + laptop API)

Students use a **Sites** frontend (QR). The laptop runs MySQL + FastAPI; an HTTPS tunnel exposes **only the API**.

```bash
bash scripts/start-demo.sh
bash scripts/check-demo.sh
bash scripts/build-sites-frontend.sh   # after tunnel URL is known / if it changed
bash scripts/stop-demo.sh
```

Full runbook: [`DEMO_START.md`](DEMO_START.md). Hosting notes: [`docs/HOSTING_CHATGPT_SITES.md`](docs/HOSTING_CHATGPT_SITES.md).
