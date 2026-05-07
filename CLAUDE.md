# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: HoliGrowth

Personalized zodiac/birth-chart book site. User submits birth details → AI generates ~30–50 pages of astrology content → PDF is built and submitted to Lulu for print + ship. Target audience: women 40–70 into astrology. Originally bootstrapped on Replit; the project has since been ported off the Replit AI proxy and Replit object storage.

Stack: Node 24, TypeScript 5.9, pnpm workspaces, Express 5, MySQL + Drizzle ORM, Zod (`zod/v4` import path) + `drizzle-zod`, OpenAPI/Orval codegen, esbuild, OpenRouter, React 19 + Vite + Tailwind v4 + shadcn/ui + framer-motion, `wouter` for routing.

## Workspace layout

pnpm workspace monorepo. `preinstall` enforces pnpm — `npm install` / `yarn` will fail. The catalog in [pnpm-workspace.yaml](pnpm-workspace.yaml) pins shared versions; reference them in package.json with `"catalog:"` rather than re-declaring versions.

Packages (all `private`, all `@workspace/*`):

- [artifacts/api-server](artifacts/api-server) — Express 5 API, esbuild-bundled to a single ESM file via [build.mjs](artifacts/api-server/build.mjs).
- [artifacts/zodiac-book](artifacts/zodiac-book) — React 19 + Vite + Tailwind v4 + shadcn/ui, routed with `wouter`, data via `@tanstack/react-query`.
- [artifacts/mockup-sandbox](artifacts/mockup-sandbox) — separate Vite UI sandbox (independent of the zodiac flow).
- [lib/db](lib/db) — Drizzle schema + `mysql2`-backed client. Exports `db`, `pool`, schema, and re-exports common Drizzle helpers (`eq`, `and`, `desc`, …) so callers only import from `@workspace/db`.
- [lib/api-spec](lib/api-spec) — single source of truth: [openapi.yaml](lib/api-spec/openapi.yaml) + [orval.config.ts](lib/api-spec/orval.config.ts). Generates the next two packages.
- [lib/api-client-react](lib/api-client-react) — generated React Query hooks (do not hand-edit `src/generated/`).
- [lib/api-zod](lib/api-zod) — generated Zod schemas (do not hand-edit `src/generated/`).
- [scripts](scripts) — one-off `tsx` scripts (`pnpm --filter @workspace/scripts run <name>`).

## Common commands

Run from the repo root unless noted. The workspace uses `--filter` selectors; `-r --if-present` fans out to every package that defines a script.

```bash
pnpm install                                              # bootstrap
pnpm start:back                                           # run the API server (http://localhost:8088, loads .env)
pnpm start:front                                          # run the Vite dev server (http://localhost:5173)
pnpm run typecheck                                        # tsc --build for libs + per-package typecheck for artifacts/scripts
pnpm run build                                            # typecheck + recursive build
pnpm run build:back                                       # api-server bundle only
pnpm run build:front                                      # zodiac-book bundle only (also copies to dist/)
pnpm --filter @workspace/api-spec run codegen             # regenerate api-client-react + api-zod from openapi.yaml
pnpm --filter @workspace/db        run push               # drizzle-kit push (dev schema sync — destructive on prod)
pnpm --filter @workspace/db        run push-force         # destructive variant — confirm before running
```

There is no test runner configured — do not invent one. To "run a single test", ask the user how they want to verify.

## Architecture notes that span files

**Database is MySQL.** [lib/db/src/index.ts](lib/db/src/index.ts) wires `drizzle-orm/mysql2` to a `mysql2/promise` pool from `DATABASE_URL`. Local dev runs against MAMP (`mysql://holigrowth:…@127.0.0.1:8889/holigrowth`, browseable at `http://localhost:8888/phpMyAdmin5/`). The Drizzle schema in [lib/db/src/schema](lib/db/src/schema) deliberately mirrors the existing column types (`int autoincrement`, `varchar(N)` for short enums, `longtext` for `generated_content`) so `drizzle-kit push` is a no-op against the live DB.

**MySQL has no `.returning()`.** When inserting, capture `insertResult.insertId` and re-`select()` if you need the row. See the patterns in [routes/zodiac-orders/index.ts](artifacts/api-server/src/routes/zodiac-orders/index.ts) (insert) and [routes/settings.ts](artifacts/api-server/src/routes/settings.ts) (update).

**API codegen is one-way.** Edit [openapi.yaml](lib/api-spec/openapi.yaml), then run the codegen script. It writes into `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`, and finally runs `pnpm -w run typecheck:libs` to validate. Editing generated files directly will be clobbered on next codegen.

**API server bundle.** [build.mjs](artifacts/api-server/build.mjs) bundles everything into `dist/index.mjs` with a long `external` list of native/dynamic-load packages and a `pino` plugin (workers can't be bundled). `mysql2` is in that external list — keep it there. When adding a dep that uses native modules or path traversal, add it to `external`. The banner shims `require`, `__filename`, `__dirname` so CJS-only deps (e.g. `express`) work in the ESM output.

**Webhook ordering matters.** [app.ts](artifacts/api-server/src/app.ts) registers the Lulu and Stripe webhook routes with `express.raw()` *before* `express.json()`. Adding any `app.use(express.json(...))` above those routes will silently break signature verification.

**Frontend env loading.** [vite.config.ts](artifacts/zodiac-book/vite.config.ts) calls `loadEnv` against the workspace root so `.env` is picked up automatically. Defaults: `FRONTEND_PORT=5173`, `BASE_PATH=/`. The api-server's `start` script uses `node --env-file-if-exists=../../.env`, so backend env loads the same way. `PORT` (8088) is the API; `FRONTEND_PORT` (5173) is Vite — keep them distinct.

**Object storage is local fs.** [lib/objectStorage.ts](artifacts/api-server/src/lib/objectStorage.ts) writes to `artifacts/uploads/` (override with `UPLOADS_DIR`) and stores a `.meta.json` sidecar per file for the content type. Files are served by [routes/storage.ts](artifacts/api-server/src/routes/storage.ts) at `GET /api/storage/objects/uploads/:id`. PDFs returned by [pdfUploader.ts](artifacts/api-server/src/routes/zodiac-orders/pdfUploader.ts) embed `PUBLIC_BASE_URL` so Lulu can fetch them — **set this to a publicly-reachable origin (e.g. an ngrok tunnel) when testing the live Lulu sandbox**, otherwise Lulu's pull will fail.

**AI calls go through OpenRouter.** [lib/openrouterClient.ts](artifacts/api-server/src/lib/openrouterClient.ts) wraps the OpenRouter chat-completions endpoint with a streaming async generator (raw `fetch` + manual SSE parse — no OpenAI SDK). Requires `OPENROUTER_API_KEY`; model defaults to `openai/gpt-4o-mini` and can be overridden per-call or via `OPENROUTER_MODEL`. The only call site today is the streaming book generator at [routes/zodiac-orders/index.ts:250](artifacts/api-server/src/routes/zodiac-orders/index.ts#L250).

**TypeScript project references.** Root [tsconfig.json](tsconfig.json) references the three `lib/*` packages with build outputs (db, api-client-react, api-zod). Artifacts and scripts are *not* references — they're typechecked individually via the `typecheck` script in `package.json`. The `customConditions: ["workspace"]` in [tsconfig.base.json](tsconfig.base.json) is what lets workspace packages export `src/*.ts` directly without a build step where possible.

**Order status flow.** `pending_payment → pending → generating → generated → processing → shipped` (or `failed`). The schema default is `pending_payment` ([zodiac-orders.ts:14](lib/db/src/schema/zodiac-orders.ts#L14)).

**Lulu integration.** Falls back to a simulated demo order when `LULU_CLIENT_KEY` / `LULU_CLIENT_SECRET` are unset. `LULU_SANDBOX=true` (default) hits `api.sandbox.lulu.com`. The `POST /api/lulu/register-webhook` route auto-derives the callback URL from `PUBLIC_BASE_URL`.

**Frontend asset alias.** `@assets` resolves to the repo-root [attached_assets/](attached_assets/) directory (shared across artifacts), and `@` resolves to `artifacts/zodiac-book/src`.

**post-merge hook.** [scripts/post-merge.sh](scripts/post-merge.sh) runs `pnpm install --frozen-lockfile && pnpm --filter db push` — pulling main will mutate the dev database. Mention this if the user is about to merge.

## Required environment variables

All loaded from [.env](.env). The api-server requires: `PORT`, `DATABASE_URL`, `PUBLIC_BASE_URL`, `OPENROUTER_API_KEY`. Stripe (`STRIPE_*`), Lulu (`LULU_*`), and MailerLite (`MAILERLITE_API_KEY`) are required for the features that use them but the server boots without them. Vite reads `FRONTEND_PORT`, `BASE_PATH` (both have defaults).

## Design tokens

Defined in [zodiac-book](artifacts/zodiac-book) Tailwind config / CSS. Midnight navy bg (`hsl(240 64% 8%)`), amethyst secondary (`hsl(284 71% 22%)`), warm gold accent (`hsl(44 54% 54%)`). Headings: Cormorant Garamond. Body: Plus Jakarta Sans.
