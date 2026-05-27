#!/bin/bash
# Single-command deploy for the Cloudways holigrowth-api app.
#
# Usage on the server (from ~/public_html):
#
#   ./deploy.sh
#
# Sets PM2_HOME inline before invoking pm2, because Cloudways gives this app
# a read-only home dir (~/.bashrc itself is unwritable), so we can't persist
# the export the usual way. The default ~/.pm2/ location is unreachable;
# we keep pm2's state inside ~/public_html/.pm2-holigrowth/ instead.
#
# `set -e` aborts immediately on any failed step — better than barreling on
# and leaving a half-built dist/ paired with the old api-server bundle.
set -e

# Cloudways-specific: this app's home dir is read-only, so PM2 can't write
# to ~/.pm2/. Relocate its state to the writable public_html/.
export PM2_HOME="$HOME/public_html/.pm2-holigrowth"

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
