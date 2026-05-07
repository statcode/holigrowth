import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn(
    "[db] DATABASE_URL is not set. Add a MySQL connection string to enable database access.",
  );
}

export const pool = databaseUrl
  ? mysql.createPool(databaseUrl)
  : (null as unknown as mysql.Pool);

export const db = databaseUrl
  ? drizzle(pool, { schema, mode: "default" })
  : (null as unknown as ReturnType<typeof drizzle<typeof schema>>);

export * from "./schema";
export { eq, and, or, ne, gt, gte, lt, lte, desc, asc, count, sql, inArray, isNull, isNotNull } from "drizzle-orm";
