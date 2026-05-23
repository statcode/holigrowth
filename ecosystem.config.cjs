/**
 * pm2 process config for the api-server on Cloudways (and any plain Linux host).
 *
 * Usage on the server (first deploy):
 *   pnpm install --frozen-lockfile
 *   pnpm build:front
 *   pnpm build:back
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                  # persist process list across reboots
 *   pm2 startup               # one-time: install the systemd hook
 *
 * Usage on every subsequent deploy:
 *   git pull origin main
 *   pnpm install --frozen-lockfile
 *   pnpm build:front
 *   pnpm build:back
 *   pm2 reload holigrowth-api    # zero-downtime restart
 *
 * `pnpm install --frozen-lockfile` ensures the production install matches the
 * committed `pnpm-lock.yaml`. Skip it if no dependencies changed since the
 * last deploy.
 */
module.exports = {
  apps: [
    {
      name: "holigrowth-api",
      script: "./artifacts/api-server/dist/index.mjs",
      // Use Node's built-in env-file loader so .env at the repo root is read
      // exactly the same way as `pnpm start:back` does locally. The api-server
      // bundle is ESM, so we also enable source maps for nicer stack traces.
      node_args: "--enable-source-maps --env-file-if-exists=./.env",
      // Single instance — the api-server has in-process state (Pino logger,
      // template embed cache, settings cache). Don't run in cluster mode
      // without first auditing those caches for cross-process consistency.
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      // Restart if the process exits 5+ times within 10s — usually a bad env
      // or a missing build artifact. Without this, pm2 keeps crash-looping.
      max_restarts: 10,
      min_uptime: "10s",
      // Hard cap on memory; restart if the process leaks past 512MB. The
      // api-server's working set is well under this; tune up if real usage
      // requires it.
      max_memory_restart: "512M",
      // Pino logs are JSON-structured on stdout. Let pm2 capture them; tail
      // with `pm2 logs holigrowth-api`. Date-stamping per line is helpful
      // when scrolling old logs.
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
