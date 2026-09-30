import { defineConfig, devices } from "@playwright/test";
// Smoke tests against the BUILT artifact served with the production header set (not the Vite dev server).
const port = Number(process.env.TRAIL_TEST_PORT ?? 4174);
export default defineConfig({
  testDir: "tests/dist",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node tools/serve-dist.mjs --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  reporter: "list",
});
