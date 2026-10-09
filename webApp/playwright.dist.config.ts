import { defineConfig, devices } from "@playwright/test";
import { browserPortRange } from "./tools/lib/browser-port.mjs";
import { checkDistExpectations } from "./tools/lib/dist-expectations.mjs";
checkDistExpectations();
// Smoke tests against the BUILT artifact served with the production header set (not the Vite dev server).
const port = browserPortRange(process.env.TRAIL_TEST_PORT ?? 4174, 1);
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
    reuseExistingServer: process.env.TRAIL_REUSE_SERVER === "1",
  },
  reporter: "list",
});
