import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Rebuilds the test database from the real migrations before the suite runs. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://bfc:bfc@localhost:5432/bfc_test";
  if (!/test/.test(new URL(url).pathname)) throw new Error(`Refusing to wipe a database whose name does not contain "test": ${url}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
}
