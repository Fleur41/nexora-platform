import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real stack: Django on :8000 (with Postgres) and Next.js on
// :3000. Start both first (see README), then run `npm run test:e2e`.
// For QA, `npm run test:e2e:headed` shows the browser (HEADED=1) and slows each action
// (E2E_SLOW_MO, in milliseconds) so the flow can be followed on screen.
const headed = Boolean(process.env.HEADED);
const slowMo = Number(process.env.E2E_SLOW_MO ?? (headed ? 300 : 0));

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  // One browser window at a time when watching.
  workers: headed ? 1 : undefined,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: !headed,
    launchOptions: { slowMo },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
