import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real stack: Django on :8000 (with Postgres) and Next.js on
// :3000. Start both first (see README).
//
//   e2e/smoke/       fast, independent checks of each feature (CI)      npm run test:e2e
//   e2e/regression/  one slow journey from sign-up to move-out (QA)     npm run test:regression
//   e2e/pages/       page objects shared by the tests
//   e2e/support/     fixtures and test data
//
// HEADED=1 shows the browser and runs one test at a time. E2E_SLOW_MO (milliseconds) slows
// every action; when headed it defaults to 300 for smoke and 800 for the regression journey.
const headed = Boolean(process.env.HEADED);
const slowMo = (headedDefault: number) => Number(process.env.E2E_SLOW_MO ?? (headed ? headedDefault : 0));

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  // One browser window at a time when watching.
  workers: headed ? 1 : undefined,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: !headed,
    // A stuck click or navigation fails with a clear message instead of using up the test's
    // whole timeout (which is long for the regression journey).
    actionTimeout: headed ? 30_000 : 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "desktop",
      testDir: "./e2e/smoke",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions: { slowMo: slowMo(300) } },
    },
    {
      name: "mobile",
      testDir: "./e2e/smoke",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"], launchOptions: { slowMo: slowMo(300) } },
    },
    {
      name: "regression",
      testDir: "./e2e/regression",
      // The journey is long, and slower still when watched.
      timeout: 20 * 60_000,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { slowMo: slowMo(800) },
        video: "retain-on-failure",
        screenshot: "on",
      },
    },
  ],
});
