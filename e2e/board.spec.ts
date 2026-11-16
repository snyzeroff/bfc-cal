import { expect, test } from "@playwright/test";
import { addDays, choose, futureWeekday, login, logout } from "./helpers";

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
  await choose(options.nth(1).getByLabel("Speaker availability"), "Speaker: available");
  await expect(page.getByText("Availability recorded")).toBeVisible();
  await options.nth(1).getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Date confirmed — the other options were released")).toBeVisible();
  await expect(page.getByText("Released", { exact: true })).toBeVisible();
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

test("exam rule: the 21 days before an approved exam block conferences; only a Super Admin can override", async ({ page }) => {
  const examStart = futureWeekday(120);
  const victoriales = examStart; // first exam day
  const inside = addDays(victoriales, -10);

  // An admin records the exam session on an academic layer (same result as approving an imported row).
  await login(page, "superAdmin");
  await page.goto("/board/academic");
  await page.getByRole("button", { name: "New layer" }).click();
  await page.getByRole("dialog", { name: "New layer" }).getByLabel("Name").fill("E2E program");
  await page.getByRole("dialog", { name: "New layer" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Layer saved")).toBeVisible();
  await page.getByRole("button", { name: /E2E program/ }).first().click();
  await page.getByRole("button", { name: "Add period" }).click();
  const period = page.getByRole("dialog", { name: "Add period" });
  await period.getByLabel("Label").fill("Exams");
  await choose(period.getByLabel("Kind"), "Exams");
  await period.getByLabel("First day").fill(examStart);
  await period.getByLabel("Last day").fill(addDays(examStart, 2));
  await period.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Period saved")).toBeVisible();
  await page.goto("/board/settings?tab=rules");
  await expect(page.getByLabel("Days closed before each exam session")).toHaveValue("21");
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
  await expect(blocked.getByText(/the 21 days before/).first()).toBeVisible();
  await expect(blocked.getByRole("button", { name: /Override/ })).toHaveCount(0);
  await blocked.getByRole("button", { name: "Choose another date" }).click();

  // An internal meeting on the same day is allowed.
  dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByLabel("Title").fill("E2E — board meeting in the window");
  await choose(dialog.getByLabel("Category"), "Board meeting");
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
  await expect(page.locator("body")).not.toContainText(/No conferences/);
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
  // Every widget gets our own link to the Luma page, with a drawn arrow instead of an emoji.
  const luma = page.getByRole("link", { name: "Open the full event page on Luma" });
  await expect(luma).toHaveAttribute("href", "https://luma.com/event/evt-5TKn85pTxdeOPPi");
  await expect(luma.locator("svg")).toHaveCount(1);
});

test("tasks: an admin assigns a task from the list without losing its deadline", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/board/tasks");
  await page.getByRole("radio", { name: "Everyone" }).or(page.getByRole("tab", { name: "Everyone" })).click();
  await page.getByLabel("New task").fill("E2E — print the badges");
  await page.getByLabel("Deadline").fill(futureWeekday(6));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: "E2E — print the badges" });
  await expect(row).toBeVisible();
  await choose(row.getByLabel("Assignee"), "Max Member");
  await expect(row.getByLabel("Assignee")).toContainText("Max Member");
  await page.reload();
  await page.getByRole("radio", { name: "Everyone" }).or(page.getByRole("tab", { name: "Everyone" })).click();
  const again = page.getByRole("listitem").filter({ hasText: "E2E — print the badges" });
  await expect(again.getByLabel("Assignee")).toContainText("Max Member");
  await expect(again.getByText(/^Due /)).toBeVisible(); // reassigning used to wipe the deadline
});

test("account menu: clicking your name unfolds a menu that leads to your profile, where you can rename yourself", async ({ page }) => {
  // A Super Admin also finds the settings there.
  await login(page, "superAdmin");
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect(page.getByRole("menuitem", { name: "My profile" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/board\/settings$/);
  await logout(page);

  await login(page, "member");
  await page.getByRole("button", { name: /^Account/ }).click();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitem", { name: "System" }).click();
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitem", { name: "My profile" }).click();
  await expect(page).toHaveURL(/\/board\/profile$/);
  const name = page.getByRole("form", { name: "Display name" });
  await name.getByLabel("Display name").fill("Max Member-Renamed");
  await name.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Name saved")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Account/ })).toContainText("Max Member-Renamed");
  // Wrong current password: nothing changes.
  const pw = page.getByRole("form", { name: "Change password" });
  await pw.getByLabel("Current password").fill("not-my-password");
  await pw.getByLabel("New password", { exact: true }).fill("a-brand-new-password");
  await pw.getByLabel("Confirm new password").fill("a-brand-new-password");
  await pw.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Current password is incorrect.")).toBeVisible();
  // Put the name back for the other tests.
  await name.getByLabel("Display name").fill("Max Member");
  await name.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Name saved").last()).toBeVisible();
});

test("invitation link: a Super Admin sets the role and the number of accounts; the link stops when full", async ({ page, browser }) => {
  await login(page, "superAdmin");
  await page.goto("/board/settings?tab=users");
  await page.getByRole("button", { name: "New link" }).click();
  const dialog = page.getByRole("dialog", { name: "New invitation link" });
  await dialog.getByLabel("Name").fill("E2E board");
  await choose(dialog.getByLabel("Role"), "Board Admin");
  await dialog.getByLabel("Number of accounts").fill("1");
  await dialog.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByRole("textbox", { name: "Invitation link" }).inputValue();
  expect(url).toMatch(/\/join\/[A-Za-z0-9_-]{43}$/);
  await page.getByRole("button", { name: "Done" }).click();

  // A newcomer, in a separate browser, creates an account and lands on the board as Board Admin.
  const visitor = await browser.newContext();
  const join = await visitor.newPage();
  await join.goto(url);
  await expect(join.getByRole("heading", { name: "Join the board" })).toBeVisible();
  await expect(join.getByText("Board Admin")).toBeVisible();
  await join.getByLabel("Your name").fill("Nina Newcomer");
  await join.getByLabel("Email").fill("nina@e2e.test");
  await join.getByLabel("Password", { exact: true }).fill("nina-e2e-password");
  await join.getByLabel("Confirm password").fill("nina-e2e-password");
  await join.getByRole("button", { name: "Create account" }).click();
  await expect(join).toHaveURL(/\/board$/);
  await join.goto("/board/settings");
  await expect(join).toHaveURL(/denied=1/); // Board Admin, not Super Admin

  // The single place is taken: the link no longer works for anyone else.
  const late = await (await browser.newContext()).newPage();
  await late.goto(url);
  await expect(late.getByRole("heading", { name: "Link expired" })).toBeVisible();

  await page.reload();
  const row = page.getByText("E2E board").locator("xpath=ancestor::div[contains(@class,'flex-wrap')][1]");
  await expect(page.getByText("1 / 1 used")).toBeVisible();
  await expect(page.getByText("Joined: Nina Newcomer")).toBeVisible();
  await expect(row).toBeVisible();
  await visitor.close();
});
