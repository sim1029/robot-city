# GitHub Actions → Fly.io deploy setup

## Context

The repo had no deploy infrastructure: no `fly.toml`, `Dockerfile`, `.dockerignore`, or `.github/workflows/`. This change adds an automated deploy pipeline that runs on push to `main` (or manual `workflow_dispatch`), gated by typecheck + tests, and ships the app to a single persistent Fly.io Machine.

The app is stateful (SQLite at `data/robot-city.db`, encrypted BYOK vault, Gmail history watermark, in-memory cron state) and runs a long-lived Discord gateway + Gmail poll loop, so the Fly machine is always-on with a mounted volume.

> **Note on Docker:** Fly.io is container-only — every Machine boots a Firecracker microVM from an OCI image. There is no "ship a binary, run under systemd" path. We hand-author a minimal Bun Dockerfile (chosen over buildpack scaffolding for version pinning and size control).

## Files created

### `Dockerfile`

Multi-stage Bun image. Stage 1 installs deps with frozen lockfile; stage 2 copies source and runs `bun src/index.ts`. No build step (Bun runs TS directly per CLAUDE.md). `--production` skips dev deps (typescript, @types/*) — runtime doesn't need them.

### `.dockerignore`

Keeps build context small and avoids shipping local DB or secrets to the registry: excludes `node_modules`, `.git`, `data/`, `*.db`, `tests/`, `docs/`, `.env*`, `.claude/`.

### `fly.toml`

- `app = "robot-city"` and `primary_region = "iad"` — change before first launch if needed (`iad` = Virginia; switch to `sjc`/`lhr`/`fra` for nearer regions; rename app if `robot-city` is taken).
- **`auto_stop_machines = "off"` + `min_machines_running = 1`**: Gmail polling (`src/gmail/poll.ts`) and the cron scheduler (`src/cron/scheduler.ts`) are in-process `setInterval` loops — they only run while the machine is up. Auto-stopping breaks them.
- **`DB_PATH=/data/robot-city.db`**: pushes SQLite onto the persistent volume; the source tree at `/app` is ephemeral.
- **Volume `robot_city_data`** mounted at `/data`: holds SQLite + future state.

### `.github/workflows/deploy.yml`

Two jobs: `verify` (typecheck + tests) gates `deploy` (flyctl).

- **`concurrency: fly-deploy`, `cancel-in-progress: false`**: back-to-back commits queue instead of cancelling a mid-flight deploy.
- **`needs: verify`**: deploy only runs if typecheck + tests pass.
- **`npm run test` (not `bun run test`)**: per CLAUDE.md, `npm run test` sets `DB_PATH=:memory:` so tests don't clobber a real SQLite file.
- **`--remote-only`**: build happens on Fly's builders, not the GH runner — faster, no Docker-in-Docker needed.

## One-time manual setup (before the first deploy)

1. **Install flyctl** locally: `brew install flyctl` → `flyctl auth signup` (or `login`).
2. **Create the app**: `flyctl apps create robot-city` (name must match `fly.toml`).
3. **Create the volume**: `flyctl volumes create robot_city_data --size 1 --region iad --app robot-city`.
4. **Set secrets** (every env var the runtime reads — these are NOT in `fly.toml`):
   ```
   flyctl secrets set \
     DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... DISCORD_BOT_TOKEN=... DISCORD_REDIRECT_URI=https://robot-city.fly.dev/auth/discord/callback \
     GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REDIRECT_URI=https://robot-city.fly.dev/auth/google/callback \
     VAULT_PASSPHRASE=... \
     --app robot-city
   ```
   (Provider API keys — Anthropic/OpenAI/Google — are stored in the vault via `POST /vault/keys/*`, not Fly secrets. Only `VAULT_PASSPHRASE` is required as a Fly secret.)
5. **Update OAuth redirect URIs** in Google Cloud Console and Discord Developer Portal to point at `https://robot-city.fly.dev/...`.
6. **Mint a Fly API token** for CI: `flyctl tokens create deploy --name github-actions --app robot-city` → copy the token.
7. **Add to GitHub repo secrets**: Settings → Secrets and variables → Actions → New repository secret → `FLY_API_TOKEN` = (the token from step 6).

## Verification

After merging the PR that adds these files:

1. **Watch GH Actions**: Actions tab → "Deploy to Fly.io" run kicks off → `verify` passes → `deploy` runs `flyctl deploy --remote-only` → green.
2. **Confirm machine is up**: `flyctl status --app robot-city` → one machine in `started` state.
3. **Hit the health endpoint**: `curl https://robot-city.fly.dev/health` (or whichever Hono exposes — see `src/index.ts`) → 200.
4. **Confirm volume is mounted**: `flyctl ssh console --app robot-city` → `ls /data` should show `robot-city.db` (after first DB write).
5. **Manual redeploy works**: Actions tab → "Deploy to Fly.io" → "Run workflow" → fresh deploy succeeds.
6. **Failing test blocks deploy**: push a deliberately broken test to a branch, merge, confirm `verify` fails red and `deploy` never runs. Revert.

## Out of scope

- Pub/Sub Gmail push (deferred to M4 per CLAUDE.md key decision log).
- Fly Scheduled Machines for cron (deferred to M4+).
- Multi-region or zero-downtime rolling deploys (single-user app).
