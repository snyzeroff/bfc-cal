import { expect, test } from "@playwright/test";
import postgres from "postgres";

const db = () => postgres(process.env.E2E_DATABASE_URL ?? "postgres://bfc:bfc@localhost:5432/bfc_e2e", { max: 1 });

test.describe("members (no account)", () => {
  test("see published events only", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Conferences/ })).toBeVisible();
    await expect(page.getByText("Seeded public conference").first()).toBeVisible();
    await expect(page.getByText("Seeded private conference")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("E2E-PRIVATE-NOTE");
  });

  test("can open a published event and its registration details", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Seeded public conference/ }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Seeded public conference" })).toBeVisible();
    await expect(page.getByText("Amphi E2E")).toBeVisible();
    await expect(page.getByText("Open to everyone.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("E2E-PRIVATE-NOTE");
  });

  test("cannot reach a private event by its id — page, API or single-event export", async ({ page, request }) => {
    const sql = db();
    const [{ id }] = await sql`select id from events where title = 'Seeded private conference'`;
    await sql.end();
    expect((await page.goto(`/events/${id}`))?.status()).toBe(404);
    expect((await request.get(`/events/${id}/calendar.ics`)).status()).toBe(404);
    const api = await (await request.get("/api/public/events")).json();
    const titles = api.events.map((e: { title: string }) => e.title);
    expect(titles).toContain("Seeded public conference");
    expect(titles).not.toContain("Seeded private conference");
    expect(JSON.stringify(api)).not.toContain("E2E-PRIVATE-NOTE");
    expect(JSON.stringify(api)).not.toMatch(/internal|organizer|version/i);
  });

  test("the public feed is a valid, uncached calendar with published events only", async ({ request }) => {
    const res = await request.get("/feeds/public.ics");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    expect(res.headers()["cache-control"]).toContain("must-revalidate");
    const body = await res.text();
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain("SUMMARY:Seeded public conference");
    expect(body).not.toContain("Seeded private conference");
    expect(body).not.toContain("E2E-PRIVATE-NOTE");
  });

  test("board pages, exports and private feeds are closed", async ({ page, request }) => {
    await page.goto("/board/calendar");
    await expect(page).toHaveURL(/\/login/);
    expect((await request.get("/board/events/export", { maxRedirects: 0 })).status()).not.toBe(200);
    expect((await request.get("/feeds/board/" + "a".repeat(43) + ".ics")).status()).toBe(404);
    expect((await request.get("/api/cron/publish")).status()).toBe(401);
  });

  test("the subscribe page offers a copyable address and per-app instructions", async ({ page }) => {
    await page.goto("/subscribe");
    await expect(page.getByLabel("Calendar address")).toHaveValue(/\/feeds\/public\.ics$/);
    await page.getByRole("tab", { name: "Google Calendar" }).click();
    await expect(page.getByRole("link", { name: "Add to Google Calendar" })).toHaveAttribute("href", /calendar\.google\.com.*webcal/);
    await expect(page.getByText(/its own schedule/)).toBeVisible();
  });

  test("wrong credentials are refused without revealing which part is wrong", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@e2e.test");
    await page.getByLabel("Password").fill("whatever-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
