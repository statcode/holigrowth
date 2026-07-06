/**
 * pm2 process config for the api-server on Cloudways (and any plain Linux host).
 *
 * ─── ⚠ Cloudways one-time setup: ~/.pm2/ writable by SSH user ──────────────
 *
 * Cloudways' app shells often ship with a READ-ONLY home directory (owned by
 * root, mode 0755), so the system-installed pm2 at `/usr/bin/pm2` can't
 * create its default `~/.pm2/` state directory and every command fails with:
 *
 *     EACCES: permission denied, mkdir '/home/.../.pm2/logs'
 *
 * The clean fix is a one-line Cloudways support ticket:
 *
 *     Please create ~/.pm2/ for the <app> app, owned by user <ssh-user>,
 *     mode 775. The colorgifts app on the same VM already has this set up
 *     — could you mirror that?
 *
 * Free, ~24h turnaround. Once it's in place, everything below works the
 * same as any other Linux host — no PM2_HOME env var, no workaround script.
 *
 * ─── First deploy on a new server ──────────────────────────────────────────
 *
 *   # one-time: pnpm version match (Cloudways' system pnpm may be old)
 *   npm install -g pnpm@10.33.0
 *
 *   # deploy
 *   git clone <repo> ~/public_html && cd ~/public_html
 *   pnpm install --frozen-lockfile
 *   pnpm build:front
 *   pnpm build:back
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                  # persist process list across reboots
 *   pm2 startup               # one-time: install the systemd hook (may need sudo)
 *
 * ─── Every subsequent deploy ───────────────────────────────────────────────
 *
 *   cd ~/public_html
 *   git pull origin main
 *   pnpm install --frozen-lockfile        # skip if deps unchanged
 *   pnpm build:front
 *   pnpm build:back
 *   pm2 reload holigrowth-api             # zero-downtime restart
 *
 *   # ⚠ THEN purge the upstream HTML caches (see warning below). Skipping
 *   #   this is what causes "page loads blank in Firefox/Safari" after a
 *   #   deploy: Varnish keeps serving a stale index.html that points at
 *   #   deleted /assets/<old-hash>.css files.
 *
 * `pnpm install --frozen-lockfile` ensures the production install matches the
 * committed `pnpm-lock.yaml`. If the server's pnpm version differs from the
 * one in `package.json` → `packageManager`, the install will fail with
 * ERR_PNPM_LOCKFILE_CONFIG_MISMATCH — `npm install -g pnpm@<version>` to
 * align, or drop `--frozen-lockfile` for one-off recovery.
 *
 * ─── ⚠ Cache purges after every deploy ────────────────────────────────────
 *
 * Three caches sit in front of Apache on Cloudways. After every deploy that
 * regenerates `dist/index.html` (which is every `pnpm build:front`), at
 * least the first two need a manual purge, or stale clients will fetch
 * old hashed assets that no longer exist on disk and the page renders
 * blank in Firefox/Safari (Chrome is lenient about the MIME mismatch).
 *
 *   1. Cloudways Varnish (front-of-Apache HTML cache)
 *      Cloudways panel → Applications → holigrowth → Application Settings
 *        → General → "Purge Site Cache" → click Purge.
 *      Long-term fix: turn Varnish off for this app (same panel →
 *      Varnish tab → toggle off). For a static-asset SPA + JSON API,
 *      server-side HTML caching is pure cost — Cloudflare handles the
 *      edge tier faster.
 *
 *   2. Cloudflare CDN (edge cache)
 *      Cloudflare dashboard → holigrowth.com → Caching → Configuration →
 *        Purge Cache → "Purge Everything" (or single-file: /  +
 *        /index.html).
 *
 *   3. Browser cache (each tester's local cache)
 *      Cmd+Shift+R in Firefox/Chrome, or hold Shift while clicking refresh
 *      in Safari. Not strictly required since dist/.htaccess now sets
 *      Cache-Control: no-store on index.html, but Varnish/Cloudflare
 *      stripping that header is exactly what causes the bug — purge
 *      upstream first, then refresh the browser.
 *
 * Telltale signs you forgot a purge: index.html still 304s with an old
 * date in DevTools Network → Response Headers, AND the css/js requests
 * fail with `NS_ERROR_CORRUPTED_CONTENT` or a "MIME type was 'text/html'"
 * console warning. Look at the asset filename hashes — if they don't
 * match what's currently in `~/public_html/dist/assets/`, you're being
 * served a stale shell.
 *
 * ─── Port assignments on shared Cloudways VMs ─────────────────────────────
 *
 * Every Node app on this Cloudways VM (526984.cloudwaysapps.com) binds to
 * 127.0.0.1:PORT on the host loopback. Collisions crash-loop pm2 with
 * EADDRINUSE. Current assignments:
 *
 *   colorgifts-api   → 8088
 *   holigrowth-api   → 8089   ← this app
 *
 * When adding a new app, claim the next free port (8090, …) and update
 * BOTH the app's .env PORT value AND its public/.htaccess reverse-proxy
 * target. The .htaccess port is baked in at build time, so the two must
 * match per-app.
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
        // ─── Fontconfig cache (Cloudways read-only-home workaround) ────────
        // Fontconfig's default cache lookup is: $FC_CACHEDIR → $XDG_CACHE_HOME
        // /fontconfig → ~/.cache/fontconfig → ~/.fontconfig → /var/cache/
        // fontconfig. On Cloudways the first four fall through (~/ and its
        // subdirs are read-only for the app user), landing on /var/cache/
        // fontconfig which is root-owned. Every sharp call that rasterises
        // an SVG then floods stderr with:
        //   Fontconfig error: No writable cache directories
        // and text glyphs quietly fall back to a default face — bad for the
        // natal-wheel pipeline where planet labels + degree markers matter.
        //
        // Point $FC_CACHEDIR at ~/public_html/.cache/fontconfig (created in
        // deploy.sh). Resolved at pm2 startup so this works on any host
        // where $HOME is set — no per-server hardcoding.
        FC_CACHEDIR: `${process.env.HOME || ""}/public_html/.cache/fontconfig`,
      },
    },
  ],
};
