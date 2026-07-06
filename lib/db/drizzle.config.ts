import { defineConfig } from "drizzle-kit";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bootstrap DATABASE_URL from the workspace-root .env if it's not already
// in the environment. Makes `pnpm --filter @workspace/db run push` work
// from any shell without needing a `set -a; . ./.env` dance in deploy.sh —
// which historically failed silently on prod when the .env file had a
// URL-encoded password ("%21"), CRLF line endings, or comments the shell
// tried to interpret. Reading the file ourselves is bulletproof.
if (!process.env.DATABASE_URL) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // lib/db/drizzle.config.ts → workspace root two levels up.
  const envPath = path.resolve(here, "..", "..", ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m && !process.env[m[1]!]) {
        process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
      }
    }
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add it to workspace-root .env, or export " +
    "it before running any drizzle-kit command.",
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
