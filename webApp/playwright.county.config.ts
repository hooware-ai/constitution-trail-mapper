import { defineConfig, devices } from "@playwright/test";
// County-mode browser suite: the packaged-dataset production path, run against SYNTHETIC data built into the real
// artifact layout (tests/support/serve-county.mjs). Three owned ports: a review-channel build, a public-channel build
// and a review build that also packages the synthetic OpenStreetMap supplement. None is ever reused.
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
      testIgnore: /osm-supplement|access-tiles|proposed-layer/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testDir: "tests/county",
      testIgnore: /osm-supplement|access-tiles|proposed-layer/,
      use: { ...devices["Pixel 7"] },
    },
    // The county build that also packages the SYNTHETIC reviewed OpenStreetMap supplement (its own port).
    {
      name: "osm-chromium",
      testDir: "tests/county",
      testMatch: /osm-supplement/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${port + 2}`,
      },
    },
    // The county build that also packages SYNTHETIC ordinary-road access as base roads plus on-demand tiles (port + 3).
    {
      name: "access-chromium",
      testDir: "tests/county",
      testMatch: /access-tiles/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${port + 3}`,
      },
    },
    {
      name: "access-mobile",
      testDir: "tests/county",
      testMatch: /access-tiles/,
      use: { ...devices["Pixel 7"], baseURL: `http://127.0.0.1:${port + 3}` },
    },
    // The county build that also packages SYNTHETIC proposed trails through the rights-gated seam (port + 4).
    {
      name: "proposed-chromium",
      testDir: "tests/county",
      testMatch: /proposed-layer/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${port + 4}`,
      },
    },
    {
      name: "proposed-mobile",
      testDir: "tests/county",
      testMatch: /proposed-layer/,
      use: { ...devices["Pixel 7"], baseURL: `http://127.0.0.1:${port + 4}` },
    },
    {
      name: "osm-mobile",
      testDir: "tests/county",
      testMatch: /osm-supplement/,
      use: { ...devices["Pixel 7"], baseURL: `http://127.0.0.1:${port + 2}` },
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
    {
      command: `node tests/support/serve-county.mjs --port ${port + 4} --proposed`,
      url: `http://127.0.0.1:${port + 4}`,
      reuseExistingServer: false,
      timeout: 180000,
    },
    {
      command: `node tests/support/serve-county.mjs --port ${port + 3} --access`,
      url: `http://127.0.0.1:${port + 3}`,
      reuseExistingServer: false,
      timeout: 180000,
    },
    {
      command: `node tests/support/serve-county.mjs --port ${port + 2} --osm`,
      url: `http://127.0.0.1:${port + 2}`,
      reuseExistingServer: false,
      timeout: 180000,
    },
  ],
  reporter: "list",
});
