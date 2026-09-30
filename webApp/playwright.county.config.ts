import { defineConfig, devices } from "@playwright/test";
// County-mode browser suite: the packaged-dataset production path, run against SYNTHETIC data built into the real
// artifact layout (tests/support/serve-county.mjs). Two owned ports: a review-channel build and a public-channel
// build. Neither is ever reused.
const port = Number(process.env.TRAIL_TEST_PORT ?? 4175);
// The artifact-level county checks live with the dist smoke tests and are enabled by this variable.
process.env.TRAIL_EXPECT_DATASET = "county";
export default defineConfig({
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      testDir: "tests/county",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testDir: "tests/county",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "artifact",
      testDir: "tests/dist",
      testMatch: "county-smoke.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `node tests/support/serve-county.mjs --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 180000,
    },
    {
      command: `node tests/support/serve-county.mjs --port ${port + 1} --public`,
      url: `http://127.0.0.1:${port + 1}`,
      reuseExistingServer: false,
      timeout: 180000,
    },
  ],
  reporter: "list",
});
