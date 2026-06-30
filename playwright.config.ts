import { defineConfig, devices } from "@playwright/test";

const apiPort = Number(process.env.E2E_API_PORT ?? 18080);
const webPort = Number(process.env.E2E_WEB_PORT ?? 15173);
const apiBaseURL = process.env.E2E_API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const webBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: webBaseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @workspace/api-server run dev",
      url: `${apiBaseURL}/api/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: String(apiPort),
        HISTORICAL_DATA_MAX_ATTEMPTS: "0",
        LIVE_DATA_PROVIDER: "disabled",
      },
    },
    {
      command: "pnpm --filter @workspace/world-cup-oracle run dev",
      url: webBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: String(webPort),
        API_PROXY_TARGET: apiBaseURL,
      },
    },
  ],
});
