# Hosting handoff for ChatGPT Sites (do not deploy from this doc)

QuestBoard’s full stack is **React (Vite) + FastAPI + MySQL + private proof media**. ChatGPT Sites is assumed **not** to run FastAPI, MySQL, background jobs, or durable private file storage. Prepare for Sites later using one of the options below. **Do not deploy, publish, or migrate production data from this document.**

## Option A — Full application frontend → externally hosted API

Use the production frontend build against a separately hosted backend, database, and media volume.

### Build

```bash
cd apps/frontend
cp .env.example .env   # set live flags + public API origin (no secrets in the bundle beyond the public URL)
npm install
npm run build
```

**Output directory:** `apps/frontend/dist/`

### Frontend environment variable names (values are deployment-specific)

| Name | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend **origin** only (example shape: `https://api.example.com`) — no path suffix |
| `VITE_QUESTS_ENABLED` / `VITE_CATALOGUE_ENABLED` | Catalogue UI |
| `VITE_QUESTS_DEMO` | Must be `false` for live catalogue |
| `VITE_PROOFS_DEMO` / `VITE_PROOFS_API` | Student proof (`false` / `true` for live) |
| `VITE_MODERATION_API` | Moderator queue (`true` when review routes are live) |
| `VITE_REWARDS_DEMO` / `VITE_REWARDS_API` | Achievements/rewards (`false` / `true` for live) |
| `VITE_DISCUSSIONS_DEMO` / `VITE_DISCUSSIONS_API` | Grove/quest discussions — keep **both `false`** for this RC |
| `VITE_ROLE_REQUESTS_ENABLED` | Role-request UI |

Never enable demo + live for the same feature. Live mode must not fall back to demo after failure.

### Routing / base path

- Vite SPA: host `dist/` as static files.
- If Sites (or the CDN) serves under a subpath, configure Vite `base` accordingly before build; deep links need SPA fallback to `index.html`.

### Backend / CORS / data requirements (external host)

- Run FastAPI (`apps/backend`) with MySQL and applied migrations `0001`…`0021`.
- Set CORS to allow the Sites origin.
- Persist `PROOF_MEDIA_DIR` on a durable volume (or object store); serve only via authenticated `GET /media/{id}`.
- Schedule `make cleanup-uploads` (or `python -m jobs.cleanup_uploads`).
- JWT and MySQL credentials stay on the server — never in the frontend bundle.

### Features available (Option A)

Auth/profile, role requests, organizer create/edit/publish, discovery/search/filters/pagination, join/RSVP, My Quests/calendar, proof upload + private media, moderator approve/reject + resubmit, points/badges, rewards/claims.

### Limitations (Option A)

- Quest Grove / quest discussions: **deferred** (flags off; unavailable UI).
- Twists: not implemented (`twist=None`).
- Sites alone cannot host the API/DB/media; they only host the static frontend.

---

## Option B — Self-contained frontend demonstration (DEV sample mode)

Useful for a static Sites demo **without** a backend. This is **not** the integrated product.

### How it works today

- Sample catalogue/proof/rewards/discussions are gated by `import.meta.env.DEV` plus demo flags.
- Production `npm run build` **strips DEV**, so demo stores do not activate in a normal production bundle.
- A true Sites demo therefore needs an **explicit future demo build** (for example a dedicated mode that does not rely on `import.meta.env.DEV`) **or** serving `vite` preview/dev only for internal demos — not for claiming live integration.

### If / when a dedicated static demo build exists

Document then:

| Item | Expectation |
|---|---|
| Build | Dedicated demo script/output (to be added before Sites demo publish) |
| Env | No `VITE_API_BASE_URL` required; **no** localhost calls |
| Label | Compact visible “Demo / sample data” banner |
| Reset | Clear tab storage only |
| Secrets | No real credentials, private records, or backend secrets |
| Limitations | Joins/posts/proofs/rewards are not shared; not product acceptance |

Until that dedicated build exists, **Option A is the hosting path for the real application.** The recovered Nov 12 sample UI under `outputs/recovered-nov12/` is local-only and must not be published as the RC.

---

## Recommendation for later Sites handoff

1. Host MySQL + FastAPI + media elsewhere (Option A).
2. Point Sites (or any static host) at `apps/frontend/dist` built with live flags and the public API origin.
3. Keep discussion flags false until Grove acceptance.
4. Treat any browser-only sample UI as a separate demo, never as completed integration.

---

## Classroom demo (laptop + Sites + tunnel)

See **`DEMO_START.md`** and `scripts/start-demo.sh` / `check-demo.sh` / `stop-demo.sh` for the ChatGPT Sites + HTTPS API tunnel workflow. MySQL stays on the laptop; only the API is tunneled.
