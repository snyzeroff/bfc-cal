import { expect, test } from "@playwright/test";
import { addDays, futureWeekday, login, logout } from "./helpers";

test.describe.configure({ mode: "serial" });

const TITLE = "E2E — Careers in private equity";
const optionA = futureWeekday(40);
const optionB = addDays(optionA, 7);

test("conference workflow: propose dates → confirm → publish → update → cancel", async ({ page, request }) => {
  await login(page, "admin");

  // 1. Propose a conference with two candidate dates.
  await page.getByRole("button", { name: "New event" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByLabel("Title").fill(TITLE);
  await dialog.getByRole("radio", { name: "Propose dates" }).click();
  await dialog.getByLabel("Date", { exact: true }).fill(optionA);
  await dialog.getByRole("button", { name: "Add another option" }).click();
  await dialog.getByLabel("Option 2").fill(optionB);
  await dialog.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/board\/events\/[0-9a-f-]{36}/);
  const eventUrl = page.url();
  const id = eventUrl.split("/").pop()!;
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.getByText("2 proposed dates, none confirmed")).toBeVisible();

  // 2. The tentative holds are private.
  expect(await (await request.get("/feeds/public.ics")).text()).not.toContain("Careers in private equity");

  // 3. Record the speaker's answer and confirm one option: the other is released.
  await page.getByRole("tab", { name: /Dates/ }).click();
  const options = page.getByRole("listitem").filter({ has: page.getByLabel("Speaker availability") });
  await expect(options).toHaveCount(2);
  await options.nth(1).getByLabel("Speaker availability").selectOption("available");
  await expect(page.getByText("Availability recorded")).toBeVisible();
  await options.nth(1).getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Date confirmed — the other options were released")).toBeVisible();
  await expect(page.getByText("Released")).toBeVisible();
  await expect(page.getByLabel("Speaker availability")).toHaveCount(0);

  // 4. Confirmed is not public.
  await expect(page.getByText("Board only")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(TITLE)).toHaveCount(0);

  // 5. Publish: visible to members and in the feed.
  await page.goto(eventUrl);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published — members and subscribers can now see it")).toBeVisible();
  const first = await (await request.get("/feeds/public.ics")).text();
  expect(first).toContain(`UID:event-${id}@bfc-calendar`);
  expect(first).toContain("SUMMARY:E2E — Careers in private equity");
  const seq1 = Number(/UID:event-[^\r]*bfc-calendar[\s\S]*?SEQUENCE:(\d+)/.exec(first.slice(first.indexOf(`UID:event-${id}`)))![1]);
  await page.goto("/");
  await expect(page.getByText(TITLE).first()).toBeVisible();

  // 6. A later change of room propagates to the website and the feed, with a higher SEQUENCE.
  await page.goto(eventUrl);
  await page.getByLabel("Location").fill("Amphi Janet");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();
  const second = await (await request.get("/feeds/public.ics")).text();
  const block = second.slice(second.indexOf(`UID:event-${id}`));
  expect(block).toContain("LOCATION:Amphi Janet");
  expect(Number(/SEQUENCE:(\d+)/.exec(block)![1])).toBeGreaterThan(seq1);
  await page.goto(`/events/${id}`);
  await expect(page.getByText("Amphi Janet")).toBeVisible();

  // 7. Cancellation: shown to members, STATUS:CANCELLED for subscribers.
  await page.goto(eventUrl);
  await page.getByRole("button", { name: /Status: Published/ }).click();
  await page.getByRole("menuitem", { name: "Cancelled" }).click();
  await expect(page.getByText("Status updated")).toBeVisible();
  const third = await (await request.get("/feeds/public.ics")).text();
  expect(third.slice(third.indexOf(`UID:event-${id}`))).toMatch(/STATUS:CANCELLED/);
  await page.goto(`/events/${id}`);
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();

  // 8. The history recorded who did what.
  await page.goto(`${eventUrl}?tab=history`);
  await expect(page.getByText(/Published “E2E/)).toBeVisible();
  await expect(page.getByText(/status published → cancelled/)).toBeVisible();
});

test("Victoriales: the date is configurable, the 21-day period blocks conferences, only a Super Admin can override", async ({ page }) => {
  const victoriales = futureWeekday(120);
  const inside = addDays(victoriales, -10);

  // Super Admin sets the date.
  await login(page, "superAdmin");
  await page.goto("/board/settings?tab=rules");
  await page.getByLabel("First day").fill(victoriales);
  await page.getByRole("button", { name: "Save Victoriales date" }).click();
  await expect(page.getByText("Victoriales saved — restricted period recalculated")).toBeVisible();
  await expect(page.getByText(/Restricted:/)).toBeVisible();
  await logout(page);

  // A board member is warned before submitting, and blocked if they insist.
  await login(page, "member");
  await page.getByRole("button", { name: "New event" }).click();
  let dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByLabel("Title").fill("E2E — blocked conference");
  await dialog.getByRole("radio", { name: "Date is set" }).click();
  await dialog.getByLabel("Date", { exact: true }).fill(inside);
  await expect(dialog.getByText("Restricted period", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Create event" }).click();
  const blocked = page.getByRole("dialog", { name: "This date is restricted" });
  await expect(blocked).toBeVisible();
  await expect(blocked.getByText(/21 days before Victoriales/).first()).toBeVisible();
  await expect(blocked.getByRole("button", { name: /Override/ })).toHaveCount(0);
  await blocked.getByRole("button", { name: "Choose another date" }).click();

  // An internal meeting on the same day is allowed.
  dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByLabel("Title").fill("E2E — board meeting in the window");
  await dialog.getByLabel("Category").selectOption({ label: "Board meeting" });
  await expect(dialog.getByText("Restricted period", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Create event" }).click();
  await expect(page).toHaveURL(/\/board\/events\/[0-9a-f-]{36}/);
  await logout(page);

  // The Super Admin can override, but only with a written reason — and it is audited.
  await login(page, "superAdmin");
  await page.getByRole("button", { name: "New event" }).click();
  dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByLabel("Title").fill("E2E — exceptional conference");
  await dialog.getByRole("radio", { name: "Date is set" }).click();
  await dialog.getByLabel("Date", { exact: true }).fill(inside);
  await dialog.getByRole("button", { name: "Create event" }).click();
  const override = page.getByRole("dialog", { name: "This date is restricted" });
  await override.getByRole("button", { name: "Override as Super Admin…" }).click();
  await expect(override.getByRole("button", { name: "Override and schedule" })).toBeDisabled();
  await override.getByLabel("Reason for the exception").fill("Speaker only available that week — board vote");
  await override.getByRole("button", { name: "Override and schedule" }).click();
  await expect(page).toHaveURL(/\/board\/events\/[0-9a-f-]{36}/);
  await expect(page.getByText("Scheduled inside a restricted period by Super Admin exception")).toBeVisible();
  await page.goto("/board/settings?tab=audit");
  await expect(page.getByText("restriction.override").first()).toBeVisible();
  await expect(page.getByText("Reason: Speaker only available that week — board vote").first()).toBeVisible();

  // The restricted period is visible on the board calendar timeline, and not public.
  await page.goto("/board/calendar");
  await page.getByRole("radio", { name: "Timeline" }).click();
  await expect(page.getByRole("region", { name: /Planning timeline/ })).toBeVisible();
  await page.goto("/");
  await expect(page.locator("body")).not.toContainText(/Victoriales/);
});

test("roles: a board member has no access to settings, publishing or other people's events", async ({ page }) => {
  await login(page, "member");
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/board/settings");
  await expect(page).toHaveURL(/\/board(\?denied=1)?$/);
  await page.goto("/board/events");
  await page.getByRole("link", { name: /Seeded private conference/ }).first().click();
  await expect(page.getByText(/only its organisers and Board Admins can edit/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Title")).toBeDisabled();
});

test("private subscription: works with its secret address, stops when revoked", async ({ page, request }) => {
  await login(page, "member");
  await page.goto("/board/subscriptions");
  await page.getByRole("button", { name: "Create my private address" }).click();
  await page.getByRole("dialog", { name: "New private subscription" }).getByRole("button", { name: "Create address" }).click();
  const url = await page.getByLabel("Private calendar address").inputValue();
  expect(url).toMatch(/\/feeds\/board\/[A-Za-z0-9_-]{43}\.ics$/);

  const res = await request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.text();
  expect(body).toContain("Seeded private conference"); // board data
  expect(body).not.toContain("E2E-PRIVATE-NOTE"); // …but never internal notes

  await page.getByRole("button", { name: "Done" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Subscription revoked — the address no longer works")).toBeVisible();
  expect((await request.get(url)).status()).toBe(404);
});

test("tasks: assign, complete, and see the deadline on the board calendar only", async ({ page, request }) => {
  await login(page, "admin");
  await page.goto("/board/events");
  await page.getByRole("link", { name: /Seeded private conference/ }).first().click();
  await page.getByRole("tab", { name: /Tasks/ }).click();
  await page.getByLabel("New task").fill("E2E — book the room");
  await page.getByLabel("Deadline").fill(futureWeekday(5));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("E2E — book the room")).toBeVisible();
  await expect(page.getByText("0/1 done")).toBeVisible();
  expect(await (await request.get("/feeds/public.ics")).text()).not.toContain("book the room");
  await page.getByRole("checkbox", { name: /Complete “E2E — book the room”/ }).click();
  await expect(page.getByText("1/1 done")).toBeVisible();
});

test("calendar: drag an event to another day, then undo", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/board/calendar");
  const chip = page.locator(".fc-daygrid-event", { hasText: "Seeded private conference" }).first();
  for (let i = 0; i < 3 && !(await chip.isVisible()); i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(chip).toBeVisible();

  const from = (await chip.boundingBox())!;
  const fromDay = await chip.evaluate((el) => el.closest("[data-date]")!.getAttribute("data-date"));
  // Drop it on a neighbouring weekday cell in the same row (left if possible, else right).
  const cells = page.locator(".fc-daygrid-day");
  const index = await chip.evaluate((el) => [...document.querySelectorAll(".fc-daygrid-day")].indexOf(el.closest(".fc-daygrid-day")!));
  const target = cells.nth(index % 7 === 0 ? index + 1 : index - 1);
  const toDay = await target.getAttribute("data-date");
  const to = (await target.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 4, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByText(/^Moved to /)).toBeVisible();
  await expect(page.locator(`.fc-daygrid-day[data-date="${toDay}"]`).getByText("Seeded private conference")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Move undone")).toBeVisible();
  await expect(page.locator(`.fc-daygrid-day[data-date="${fromDay}"]`).getByText("Seeded private conference")).toBeVisible();
});

test("Luma widget: paste the embed code, feature the event, and it heads the members site", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/board/events");
  await page.getByRole("link", { name: /Seeded public conference/ }).first().click();

  // Anything that is not a Luma embed is refused before saving.
  const widget = page.getByLabel("Luma registration widget");
  await widget.fill('<iframe src="https://evil.example/embed/event/evt-1/simple"></iframe>');
  await expect(page.getByText("Only Luma registration widgets (luma.com) can be embedded.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Only Luma registration widgets (luma.com) can be embedded.").last()).toBeVisible();

  await widget.fill('<iframe src="https://luma.com/embed/event/evt-5TKn85pTxdeOPPi/simple" width="600" height="450" frameborder="0" allow="fullscreen; payment"></iframe>');
  await expect(page.getByText("Will embed https://luma.com/embed/event/evt-5TKn85pTxdeOPPi/simple")).toBeVisible();
  await page.getByRole("switch", { name: "Feature at the top of the members site" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();

  // Members see the widget at the top of the home page and on the event page, in a sandboxed frame.
  await page.context().clearCookies();
  await page.goto("/");
  const frame = page.locator('iframe[title="Registration — Seeded public conference"]');
  await expect(frame).toHaveAttribute("src", "https://luma.com/embed/event/evt-5TKn85pTxdeOPPi/simple");
  await expect(frame).toHaveAttribute("sandbox", /allow-scripts/);
  await expect(page.getByText(/Featured · Conference/)).toBeVisible();
  await page.getByRole("link", { name: "Details" }).click();
  await expect(page.locator("iframe[src^='https://luma.com/embed/event/']")).toHaveCount(1);
});
