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

echo "→ pnpm build:front"
pnpm build:front

echo "→ pnpm build:back"
pnpm build:back

echo "→ pm2 reload holigrowth-api"
pm2 reload holigrowth-api

echo "✓ deploy complete — tail logs with: pm2 logs holigrowth-api"
