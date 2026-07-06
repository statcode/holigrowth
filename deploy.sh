#!/bin/bash
# Single-command deploy for the Cloudways holigrowth-api app.
#
# Usage on the server (from ~/public_html):
#
#   ./deploy.sh
#
# `set -e` aborts immediately on any failed step — better than barreling on
# and leaving a half-built dist/ paired with the old api-server bundle.
#
# ─── Cloudways PM2_HOME workaround (re-added 2026-05-30) ────────────────────
# Cloudways' "Reset File/Folders Permissions" button (Application Settings →
# General) reverts ~/.pm2/ back to root ownership, which crashes pm2 with
# "EACCES: permission denied, mkdir '/home/.../.pm2/logs'". Support fixed it
# once on 2026-05-27, but it reverted, so we keep PM2_HOME pointed at a
# directory we always own. The dir is created on first run if missing.
# Removable if/when Cloudways stops resetting home-dir perms.
export PM2_HOME="$HOME/public_html/.pm2-holigrowth"
mkdir -p "$PM2_HOME"

set -e

# Always run from the script's own directory — lets the user invoke this
# from anywhere ("bash ~/public_html/deploy.sh") and still hit the right
# package.json.
cd "$(dirname "$0")"

echo "→ git pull origin main"
git pull origin main

echo "→ pnpm install --frozen-lockfile (skip cleanly if no dep changes)"
pnpm install --frozen-lockfile

# ─── Apply DB schema changes (drizzle-kit push) ────────────────────────────
# Reads DATABASE_URL from the app's .env file. `set -a` marks any variables
# defined between it and `set +a` for export, so drizzle-kit (which reads
# process.env.DATABASE_URL in drizzle.config.ts) can see them.
#
# `push` is dev-friendly sync, not a migration — it diffs the schema against
# the DB and applies changes directly. This is convenient but DESTRUCTIVE
# for column removes / type narrowing. For the current pattern (add nullable
# columns) it's safe. If you ever introduce a breaking schema change,
# consider switching to `drizzle-kit generate` + `drizzle-kit migrate`.
#
# Set SKIP_DB_PUSH=1 in the environment to skip (e.g. for hotfixes that
# don't touch schema).
if [ "${SKIP_DB_PUSH:-0}" != "1" ]; then
    echo "→ pnpm --filter @workspace/db run push"
    if [ -f .env ]; then
        set -a
        # shellcheck source=/dev/null
        . ./.env
        set +a
    else
        echo "  ⚠ .env not found — drizzle-kit will fail if DATABASE_URL is unset"
    fi
    pnpm --filter @workspace/db run push
fi

echo "→ pnpm build:front"
pnpm build:front

echo "→ pnpm build:back"
pnpm build:back

echo "→ pm2 startOrReload ecosystem.config.cjs --update-env"
# startOrReload is the idempotent variant — it does a graceful reload when
# the process is already registered, and a fresh start when it isn't (e.g.
# after the pm2 daemon was killed by a server reboot or a perm reset and
# the process list wasn't resurrected). Avoids the
#     [PM2][ERROR] Process or Namespace holigrowth-api not found
# failure that `pm2 reload holigrowth-api` produces in that state.
#
# --update-env tells pm2 to re-read the current environment, so any
# changes to .env between deploys (new API key, model swap, port change)
# actually land in the running process rather than getting silently
# inherited from the previous pm2 start.
pm2 startOrReload ecosystem.config.cjs --update-env

# Save the process list so the next time the pm2 daemon resurrects (server
# reboot, etc.) holigrowth-api comes back automatically.
pm2 save

echo "✓ deploy complete — tail logs with: ./pm2h logs holigrowth-api"
