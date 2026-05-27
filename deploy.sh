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
# Historical note: this script used to export PM2_HOME=$HOME/public_html/
# .pm2-holigrowth/ because Cloudways had created ~/ with no write access for
# the SSH user, so pm2 couldn't make its default ~/.pm2/. Cloudways support
# fixed that for the syffkdguxx app on 2026-05-27 by creating ~/.pm2/ owned
# by user, mode 775 — matching how the colorgifts app was already set up.
# The workaround is now removed; deploys use the standard pm2 location.
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
