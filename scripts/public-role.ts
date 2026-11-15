/**
 * Creates (or refreshes) a database role that can ONLY read the `public_events`
 * view, and prints the connection string to use as DATABASE_URL_PUBLIC.
 * Usage: npm run db:public-role -- <password>
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import postgres from "postgres";

async function main() {
  const password = process.argv[2];
  if (!password || password.length < 16 || !/^[\w-]+$/.test(password)) {
    throw new Error("Pass a password of at least 16 characters (letters, digits, - and _) as the first argument.");
  }
  const url = new URL(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  const [{ exists }] = await sql`select exists(select 1 from pg_roles where rolname = 'bfc_public')`;
  await sql.unsafe(`${exists ? "ALTER" : "CREATE"} ROLE bfc_public LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  const dbName = url.pathname.slice(1);
  await sql.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM bfc_public`);
  await sql.unsafe(`GRANT CONNECT ON DATABASE "${dbName}" TO bfc_public`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO bfc_public`);
  await sql.unsafe(`GRANT SELECT ON public_events TO bfc_public`);
  await sql.end();
  url.username = "bfc_public";
  url.password = password;
  console.log("✓ Role bfc_public can read public_events only.\n\nDATABASE_URL_PUBLIC=" + url.toString());
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
