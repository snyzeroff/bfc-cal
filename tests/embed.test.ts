import { beforeEach, describe, expect, it } from "vitest";
import { isAllowedEmbed, parseEmbed } from "@/lib/embed";
import { createEvent, publishEvent, updateEvent, type ActorUser } from "@/lib/events/service";
import { AppError } from "@/lib/errors";
import { getPublicEvent, serializePublicEvent } from "@/lib/public";
import { parisToInstant } from "@/lib/time";
import { category, makeUser, resetDb } from "./helpers";

const CODE = `<iframe
  src="https://luma.com/embed/event/evt-5TKn85pTxdeOPPi/simple"
  width="600" height="450" frameborder="0"
  style="border: 1px solid #bfcbda88; border-radius: 4px;"
  allow="fullscreen; payment" aria-hidden="false" tabindex="0"
></iframe>`;
const URL_OK = "https://luma.com/embed/event/evt-5TKn85pTxdeOPPi/simple";

describe("registration widget parsing", () => {
  it("extracts the address from the embed code Luma provides and nothing else", () => {
    expect(parseEmbed(CODE)).toEqual({ ok: true, url: URL_OK });
    expect(parseEmbed(URL_OK)).toEqual({ ok: true, url: URL_OK });
    expect(parseEmbed("https://lu.ma/event/evt-abc123")).toEqual({ ok: true, url: "https://luma.com/embed/event/evt-abc123/simple" });
    expect(parseEmbed("  ")).toEqual({ ok: true, url: "" });
  });

  it.each([
    ['<iframe src="https://evil.example/embed/event/evt-1/simple"></iframe>', /Only Luma/],
    ['<iframe src="javascript:alert(1)"></iframe>', /Only Luma|not a valid/],
    ["https://luma.com.evil.example/embed/event/evt-1/simple", /Only Luma/],
    ["http://luma.com/embed/event/evt-1/simple", /Only Luma/],
    ['<script>alert(1)</script><iframe onload="x()"></iframe>', /no address/],
    ["https://lu.ma/my-short-link", /embed code/],
    ['<iframe src="https://luma.com/embed/event/evt-1/simple"><script>x</script>" onload="alert(1)', /./],
  ])("rejects or neutralises %s", (input, message) => {
    const res = parseEmbed(input as string);
    if (res.ok) {
      // Accepted input is always rebuilt from the event id alone.
      expect(isAllowedEmbed(res.url)).toBe(true);
      expect(res.url).not.toMatch(/script|onload|"/);
    } else expect(res.error).toMatch(message as RegExp);
  });

  it("only lets canonical Luma embed addresses reach an iframe", () => {
    expect(isAllowedEmbed(URL_OK)).toBe(true);
    expect(isAllowedEmbed("https://evil.example/x")).toBe(false);
    expect(isAllowedEmbed(`${URL_OK}?x="><script>`)).toBe(false);
  });
});

describe("embed and featured flag on events", () => {
  let admin: ActorUser, member: ActorUser;
  const at = (d: string, t: string) => parisToInstant(d, t);
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("board_admin", "Ada");
    member = await makeUser("board_member", "Max");
  });

  it("is exposed publicly only once the event is published; a tampered stored value is dropped", async () => {
    const conf = await category("Conference");
    const { event } = await createEvent(admin, { title: "Luma night", categoryId: conf.id, status: "confirmed", startAt: at("2027-02-10", "18:30"), endAt: at("2027-02-10", "20:00"), embedUrl: URL_OK, featured: true });
    expect(await getPublicEvent(event.id)).toBeNull();
    await publishEvent(admin, event.id);
    const pub = serializePublicEvent((await getPublicEvent(event.id))!);
    expect(pub).toMatchObject({ embedUrl: URL_OK, featured: true });
    await updateEvent(admin, event.id, { embedUrl: "https://evil.example/frame" });
    expect(serializePublicEvent((await getPublicEvent(event.id))!).embedUrl).toBe("");
  });

  it("board members may add a widget to their own event but cannot feature it", async () => {
    const conf = await category("Conference");
    const { event } = await createEvent(member, { title: "Mine", categoryId: conf.id, featured: true });
    expect(event.featured).toBe(false);
    expect((await updateEvent(member, event.id, { embedUrl: URL_OK })).event.embedUrl).toBe(URL_OK);
    const err = await updateEvent(member, event.id, { featured: true }).catch((e) => e as AppError);
    expect((err as AppError).code).toBe("forbidden");
  });
});

describe("first-run bootstrap", () => {
  it("creates the first Super Admin only when there is no user", async () => {
    const { ensureBaseData } = await import("@/lib/bootstrap");
    const { sql } = await import("@/db");
    await resetDb();
    await sql`delete from users`;
    expect((await ensureBaseData({ email: "First@Club.fr", password: "a-long-password", name: "First" })).createdAdmin).toBe(true);
    expect((await ensureBaseData({ email: "second@club.fr", password: "a-long-password", name: "Second" })).createdAdmin).toBe(false);
    const rows = await sql`select email, role from users`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "first@club.fr", role: "super_admin" });
  });
});
