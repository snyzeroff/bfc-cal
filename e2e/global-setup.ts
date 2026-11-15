import { execSync } from "node:child_process";
import postgres from "postgres";
import { hashPassword } from "../src/lib/auth/crypto";

export const USERS = {
  superAdmin: { email: "super@e2e.test", password: "e2e-super-password", name: "Sam Super" },
  admin: { email: "admin@e2e.test", password: "e2e-admin-password", name: "Ada Admin" },
  member: { email: "member@e2e.test", password: "e2e-member-password", name: "Max Member" },
};

/** Fresh, migrated database with three accounts, one published and one private event. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://bfc:bfc@localhost:5432/bfc_e2e";
  if (!/e2e|test/.test(new URL(url).pathname)) throw new Error("Refusing to reset a non-test database");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await sql.end();
  const env = { ...process.env, DATABASE_URL: url, SEED_ADMIN_EMAIL: USERS.superAdmin.email, SEED_ADMIN_PASSWORD: USERS.superAdmin.password, SEED_ADMIN_NAME: USERS.superAdmin.name, SKIP_BOOTSTRAP_2026: "1" };
  execSync("npx tsx scripts/migrate.ts && npx tsx --conditions=react-server scripts/seed.ts", { env, stdio: "pipe" });

  const db = postgres(url, { max: 1, onnotice: () => {} });
  for (const [role, u] of [["board_admin", USERS.admin], ["board_member", USERS.member]] as const) {
    await db`insert into users (email, name, role, password_hash) values (${u.email}, ${u.name}, ${role}, ${await hashPassword(u.password)})`;
  }
  const [{ id: cat }] = await db`select id from categories where name = 'Conference'`;
  const [{ id: admin }] = await db`select id from users where email = ${USERS.admin.email}`;
  await db`insert into events (title, description, internal_notes, category_id, status, is_public, published_at, start_at, end_at, location, created_by)
           values ('Seeded public conference', 'Open to everyone. Register ↗️ now.', 'E2E-PRIVATE-NOTE', ${cat}, 'published', true, now(), now() + interval '20 days', now() + interval '20 days 90 minutes', 'Amphi E2E', ${admin})`;
  await db`insert into events (title, internal_notes, category_id, status, start_at, end_at, created_by)
           values ('Seeded private conference', 'E2E-PRIVATE-NOTE', ${cat}, 'confirmed', now() + interval '25 days', now() + interval '25 days 90 minutes', ${admin})`;
  await db.end();
}
