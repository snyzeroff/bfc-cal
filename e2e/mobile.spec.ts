import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("mobile: public calendar is readable and has no horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Seeded public conference").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("mobile: board uses bottom navigation, and tapping a day lists what is on it", async ({ page }) => {
  await login(page, "admin");
  const nav = page.getByRole("navigation", { name: "Board" }).last();
  await expect(nav.getByRole("link", { name: "Calendar" })).toBeVisible();
  await nav.getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/board\/calendar/);
  await expect(page.locator(".fc-daygrid")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator(".fc-daygrid-day:not(.fc-day-other)").nth(10).click();
  await expect(page.getByRole("region", { name: /Details for/ })).toBeVisible();
  await nav.getByRole("link", { name: "Conferences" }).click();
  await expect(page.getByRole("heading", { name: "Conferences & events" })).toBeVisible();
});
