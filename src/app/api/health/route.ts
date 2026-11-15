import { sql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sql`select 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "database_unreachable" }, { status: 503 });
  }
}
