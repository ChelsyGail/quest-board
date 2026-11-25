# Classroom demo — ChatGPT Sites + laptop API

Students open a **stable Sites frontend** (QR code). The laptop runs **MySQL + FastAPI** and an **HTTPS tunnel for the API only**. MySQL is never published.

## Exact commands (presentation day)

```bash
cd /path/to/quest-board

# One-time on this laptop (if not done yet): copy env and install tools — see below.

bash scripts/start-demo.sh
bash scripts/check-demo.sh

# If the printed Public API URL is new or changed, rebuild + re-publish Sites:
bash scripts/build-sites-frontend.sh
# then upload apps/frontend/dist/ to ChatGPT Sites and refresh the QR code.

# After class:
bash scripts/stop-demo.sh
```

Do **not** run `npm run dev` for the hosted presentation. Sites serves the production `dist/` build.

| URL | Role |
|---|---|
| **Sites URL** (QR) | Frontend only — what students open |
| **Tunnel URL** (`VITE_API_BASE_URL`) | HTTPS → laptop FastAPI — baked into the frontend at build time |
| `http://127.0.0.1:8010` (default) | Local API bind (loopback) |
| MySQL `127.0.0.1:3306` | Laptop only — **not** tunneled |

Default demo DB: `questboard_presentation`. Default API port: **8010** (avoids colliding with a local review stack on 8000). Override in `scripts/demo.env`.

---

## One-time setup on another laptop

1. Clone the repo and check out the commit that includes these scripts.
2. Install: Docker (MySQL), Python 3.13 + Poetry (`cd apps/backend && poetry install`), Node 20+ (`cd apps/frontend && npm install`), `curl`, `mysql` client, `caffeinate` (macOS).
3. Install a tunnel client:
   - **Preferred:** [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) with a **named tunnel** and stable hostname, **or**
   - Place a binary at `.tools/cloudflared` (gitignored), **or**
   - ngrok with a reserved domain (`DEMO_TUNNEL_PROVIDER=ngrok`, `DEMO_NGROK_DOMAIN=…`).
4. Copy secrets (never commit):
   ```bash
   cp .devcontainer/.env.example .devcontainer/.env   # if needed; set MYSQL_* + JWT_*
   cp scripts/demo.env.example scripts/demo.env
   # Edit scripts/demo.env: DEMO_API_PORT, DEMO_MYSQL_CONTAINER, optional named tunnel fields.
   ```
5. Ensure MySQL is running **bound to localhost**, database `questboard_presentation` exists, migrations through `0021` are applied, and presentation accounts/uploads are present.  
   **Do not** wipe/reseed as part of normal startup. Opt-in seed only when you intentionally refresh demo content.
6. Accounts: keep passwords in `docs/presentation/ACCOUNTS.local.md` (gitignored). Create a moderator with the role-request flow or a one-time local role update — never commit elevated credentials.
7. Build and publish Sites once the tunnel URL is known (`bash scripts/build-sites-frontend.sh`), then generate a QR code for the **Sites** link.

### Stable tunnel (recommended)

In `scripts/demo.env`:

```bash
DEMO_CLOUDFLARED_CONFIG=/absolute/path/to/cloudflared-demo.yml
DEMO_TUNNEL_HOSTNAME=api-your-demo.example.com
```

Ingress must forward that hostname to `http://127.0.0.1:8010` (or your `DEMO_API_PORT`). Credentials stay outside git.

### Quick tunnel (fallback)

If no named config is set, `start-demo.sh` uses a Cloudflare quick tunnel (`*.trycloudflare.com`). **The hostname changes every start.** The script prints a clear warning and compares with the previous URL.

---

## If the tunnel URL changes

1. Note the new **Public API** line from `start-demo.sh` / `var/demo-run/api-public-url.txt`.
2. Rebuild: `bash scripts/build-sites-frontend.sh https://NEW_HOST`
3. Re-upload / re-publish `apps/frontend/dist/` to ChatGPT Sites so the bundle’s `VITE_API_BASE_URL` updates.
4. **QR code:** keep the same QR if it already points at the ChatGPT Sites frontend URL and that Sites URL did **not** change. Only regenerate the QR if the Sites link itself changes. Never put the tunnel URL on the QR.
5. Run `bash scripts/check-demo.sh`, then a phone test on **mobile data**.

---

## Frontend flags (production / Sites)

Live catalogue, proofs, moderation, rewards. Demo adapters **off**. Discussions **off** until Grove + access rules pass independent verification:

```bash
VITE_API_BASE_URL=https://<tunnel-host>
VITE_QUESTS_DEMO=false
VITE_PROOFS_DEMO=false
VITE_PROOFS_API=true
VITE_MODERATION_API=true
VITE_REWARDS_DEMO=false
VITE_REWARDS_API=true
VITE_DISCUSSIONS_DEMO=false
VITE_DISCUSSIONS_API=false
```

`scripts/build-sites-frontend.sh` writes these into gitignored `apps/frontend/.env.sites.local`.

---

## Safe accounts and moderator login

- Use dedicated presentation accounts (student / organizer / moderator / admin) from `docs/presentation/ACCOUNTS.local.md`.
- Do not share the laptop JWT secret or MySQL password with students.
- Moderator: Log in on Sites → **Proof review** → open a pending submission → approve or reject.
- Student: after a decision, refresh the quest / My quests / rewards as appropriate.

---

## Pre-class phone test (mobile data)

1. `bash scripts/start-demo.sh && bash scripts/check-demo.sh`
2. On a phone **not** on the laptop’s Wi‑Fi (use cellular): open the Sites QR URL.
3. Log in as student → join a quest → upload a small photo + submit proof.
4. On laptop or second phone: moderator login → see submission → approve or reject.
5. Student checks result (pending → approved/rejected; resubmit only after reject).
6. Confirm Grove/discussions show unavailable while `VITE_DISCUSSIONS_API=false`.
7. Only if Grove was verified on this backend and you intentionally set `VITE_DISCUSSIONS_API=true`, re-test create/reply + quest active/submitted ACL.

---

## Local fallback (tunnel or Sites unavailable)

```bash
# API only (already started by start-demo), plus a local static preview of dist:
cd apps/frontend
npx --yes serve dist -l 4173
# or temporarily: npm run dev -- --host 127.0.0.1 --port 5173
```

Point a known-good local `.env` at `http://127.0.0.1:8010` for emergency projector use. Students on other devices still need the HTTPS tunnel + Sites path.

---

## What the scripts never do

- Publish MySQL through the tunnel
- `DROP` / wipe / reseed on normal start
- Delete proof uploads
- Kill unrelated processes on stop (only PIDs in `var/demo-run/demo.pids`)
- Start the React development server for the hosted class
