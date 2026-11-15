import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Client = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __bfcSql?: Client; __bfcPublicSql?: Client };

function connect(url: string): Client {
  return postgres(url, {
    max: process.env.NODE_ENV === "production" ? 5 : 10,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // compatible with transaction poolers (Supabase / Neon pgbouncer)
    onnotice: () => {},
  });
}

function mainUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and configure it.");
  return url;
}

export const sql: Client = (g.__bfcSql ??= connect(mainUrl()));
export const db = drizzle(sql, { schema });

/**
 * Connection used by everything a non-authenticated visitor can reach.
 * When DATABASE_URL_PUBLIC points at the restricted `bfc_public` role, the
 * database itself refuses to return anything but the `public_events` view.
 */
export const publicSql: Client = process.env.DATABASE_URL_PUBLIC
  ? (g.__bfcPublicSql ??= connect(process.env.DATABASE_URL_PUBLIC))
  : sql;

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
