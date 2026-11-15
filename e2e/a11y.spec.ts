import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { login } from "./helpers";

/** WCAG 2.1 A/AA rules; serious and critical violations fail the build. */
const problems: string[] = [];
async function scan(page: Page, label: string) {
  // Sections fade in on arrival: measure the settled page, not a mid-animation frame.
  await page.waitForTimeout(900);
  const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
  const results = await new AxeBuilder({ page }).withTags(tags).exclude(".fc").analyze();
  const violations = [...results.violations];
  if (await page.locator(".fc").count()) {
    // FullCalendar labels each day cell with its full date while showing only the day number
    // (label-content-name-mismatch). That markup is the library's; everything else is checked.
    const grid = await new AxeBuilder({ page }).withTags(tags).include(".fc").disableRules(["label-content-name-mismatch"]).analyze();
    violations.push(...grid.violations);
  }
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    ")}`);
  if (summary.length) problems.push(`${label}\n  ${summary.join("\n  ")}`);
}

test.describe("accessibility (axe, WCAG 2.1 AA)", () => {
  test.beforeEach(() => {
    problems.length = 0;
  });
  test.afterEach(() => {
    expect(problems, problems.join("\n")).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`public pages — ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      for (const path of ["/", "/subscribe", "/login"]) {
        await page.goto(path);
        await scan(page, `${path} [${theme}]`);
      }
      await page.goto("/");
      await page.getByRole("link", { name: /Seeded public conference/ }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await scan(page, `/events/[id] [${theme}]`);
    });

    test(`board pages — ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await login(page, "superAdmin");
      for (const path of ["/board", "/board/calendar", "/board/events", "/board/speakers", "/board/tasks", "/board/academic", "/board/subscriptions", "/board/settings", "/board/settings?tab=appearance", "/board/settings?tab=users", "/board/profile"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await scan(page, `${path} [${theme}]`);
      }
      const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://bfc:bfc@localhost:5432/bfc_e2e", { max: 1 });
      const [{ id }] = await sql`select id from events where title = 'Seeded private conference'`;
      await sql.end();
      for (const tab of ["details", "dates", "tasks", "discussion", "history", "preview"]) {
        await page.goto(`/board/events/${id}?tab=${tab}`);
        await scan(page, `/board/events/[id]?tab=${tab} [${theme}]`);
      }
    });
  }
});
