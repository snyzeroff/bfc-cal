import { expect, type Page } from "@playwright/test";
import { USERS } from "./global-setup";

export { USERS };

export async function login(page: Page, who: keyof typeof USERS) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS[who].email);
  await page.getByLabel("Password").fill(USERS[who].password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/board$/);
}

export async function logout(page: Page) {
  await page.context().clearCookies();
}

/** A weekday at least `min` days ahead, as YYYY-MM-DD. */
export function futureWeekday(min: number): string {
  const d = new Date(Date.now() + min * 86_400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
