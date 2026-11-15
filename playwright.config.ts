import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://bfc:bfc@localhost:5432/bfc_e2e";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, locale: "en-GB", timezoneId: "Europe/Paris" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile/ },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { DATABASE_URL, APP_URL: `http://localhost:${PORT}`, CRON_SECRET: "e2e-secret", NODE_ENV: "production" },
  },
});
