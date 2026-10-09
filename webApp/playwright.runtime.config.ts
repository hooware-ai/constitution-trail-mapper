import { defineConfig, devices } from "@playwright/test";
import { browserPortRange } from "./tools/lib/browser-port.mjs";
const port = browserPortRange(process.env.TRAIL_TEST_PORT ?? 4185, 1);
export default defineConfig({
  testDir: "tests/runtime",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "runtime-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "runtime-webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run dev",
    env: { TRAIL_DATASET: "county" },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  reporter: "list",
});
