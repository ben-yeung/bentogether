import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    // Locally, use the installed Chrome; CI installs Playwright's Chromium.
    ...(CI ? {} : { channel: "chrome" }),
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: [
    {
      command: "npm run dev -w @bentogether/realtime -- --persist-to .wrangler/e2e",
      url: "http://localhost:8787/health",
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: "npm run dev -w @bentogether/web",
      url: "http://localhost:5173",
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
