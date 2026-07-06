import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Serialise Errors so we ALWAYS get the underlying MySQL diagnostics —
 * driver-code, errno, sqlState, sqlMessage — instead of just Drizzle's
 * opaque "Failed query: …" wrapper. Without this, prod incidents like
 * the July 2026 lulu_cost_usd schema drift take 20 min of guessing to
 * diagnose because the real "Unknown column 'X' in 'field list'" line
 * never reaches the log.
 *
 * Recurses one level into `.cause` so mysql2's ER_* codes surface for
 * a Drizzle-wrapped error too.
 */
function serialiseError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { err };
  type SqlErr = Error & {
    code?: string; errno?: number; sqlState?: string; sqlMessage?: string;
    sql?: string; cause?: unknown;
  };
  const e = err as SqlErr;
  const out: Record<string, unknown> = {
    type: e.constructor.name,
    message: e.message,
    stack: e.stack,
  };
  if (e.code) out.code = e.code;
  if (e.errno !== undefined) out.errno = e.errno;
  if (e.sqlState) out.sqlState = e.sqlState;
  if (e.sqlMessage) out.sqlMessage = e.sqlMessage;
  if (e.sql) out.sql = e.sql.length > 400 ? `${e.sql.slice(0, 400)}…` : e.sql;
  if (e.cause instanceof Error) out.cause = serialiseError(e.cause);
  return out;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  serializers: {
    err: serialiseError,
    error: serialiseError,
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
