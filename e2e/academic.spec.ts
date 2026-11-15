import { expect, test } from "@playwright/test";
import { choose, login } from "./helpers";

test("academic calendar: import the official PDF, review, approve, and see the layer on the board calendar", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/board/academic");
  await page.getByRole("button", { name: /Import/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import an academic calendar" });
  await dialog.locator("input[type=file]").setInputFiles("tests/fixtures/academic/boe-y1-y2-2026-2027.pdf");
  await dialog.getByRole("button", { name: "Extract dates" }).click();

  // Extraction lands on the review screen; nothing is in the calendar yet.
  await expect(page).toHaveURL(/\/board\/academic\/imports\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Review imported dates" })).toBeVisible();
  await expect(page.getByText("VERSION 08/09/2026")).toBeVisible();
  await expect(page.getByRole("radio", { name: /To review 186/ })).toBeVisible();

  // Uncertain rows are singled out with the reason.
  await page.getByRole("radio", { name: /Needs attention/ }).click();
  await expect(page.getByText("Cell has no fill; span taken from the cell borders").first()).toBeVisible();

  // Approve the BoE Year 1 midterms only.
  await page.getByRole("radio", { name: /To review/ }).click();
  await choose(page.getByLabel("Layer", { exact: true }).first(), "BoE Year 1");
  await choose(page.getByLabel("Kind", { exact: true }).first(), "Midterms");
  const rows = page.getByRole("listitem").filter({ has: page.getByLabel("First day") });
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByLabel("First day")).toHaveValue("2026-10-21");
  await expect(rows.first().getByLabel("Last day")).toHaveValue("2026-10-23");
  await rows.first().getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Period approved")).toBeVisible();
  await expect(rows).toHaveCount(1);

  // A reviewer can correct a date before approving; the edit is kept.
  await rows.first().getByLabel("Last day").fill("2027-04-01");
  await rows.first().getByLabel("Last day").blur();
  await expect(page.getByText("Edited by a reviewer")).toBeVisible();
  await rows.first().getByRole("button", { name: "Approve" }).click();
  await expect(rows).toHaveCount(0);

  // The layer now exists with exactly the two verified periods, each with its source.
  await page.goto("/board/academic");
  await expect(page.getByRole("heading", { name: "BoE Year 1" })).toBeVisible();
  await expect(page.getByText("2 periods")).toBeVisible();
  await expect(page.getByText(/source: boe-y1-y2-2026-2027\.pdf, p\. 1/).first()).toBeVisible();
  await expect(page.getByText(/184 periods from/)).toBeVisible(); // the rest still awaits review

  // …and it is offered as a calendar layer.
  await page.goto("/board/calendar");
  await page.getByRole("button", { name: "Layers" }).click();
  await expect(page.getByRole("checkbox", { name: "BoE Year 1" })).toBeChecked();
});

test("academic calendar: board members cannot import, and a non-calendar file is refused", async ({ page }) => {
  await login(page, "member");
  await page.goto("/board/academic");
  await expect(page.getByRole("button", { name: /Import/ })).toHaveCount(0);
  await page.context().clearCookies();
  await login(page, "admin");
  await page.goto("/board/academic");
  await page.getByRole("button", { name: /Import/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import an academic calendar" });
  await dialog.locator("input[type=file]").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf") });
  await dialog.getByRole("button", { name: "Extract dates" }).click();
  await expect(page.getByText(/not a PDF/)).toBeVisible();
});
