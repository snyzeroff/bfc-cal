import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  // Schema changes need a direct (non-pooled) connection; Neon provides it as DATABASE_URL_UNPOOLED.
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
  console.log("✓ Database is up to date");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
