import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["E2E_PORT"] ?? 4173);
const BASE_URL = process.env["E2E_BASE_URL"] ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      // The primary target: a 1366x768 Chromebook.
      name: "chromebook",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // Chromium-based so the suite needs only one browser download.
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  // Point E2E_BASE_URL at an already-running server to skip the build step.
  ...(process.env["E2E_BASE_URL"]
    ? {}
    : {
        webServer: {
          command: `bun run build && PORT=${PORT} bun run start`,
          url: BASE_URL,
          reuseExistingServer: !process.env["CI"],
          timeout: 240_000,
        },
      }),
});
