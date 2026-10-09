import { defineConfig, devices } from "@playwright/test";
import { browserPortRange } from "./tools/lib/browser-port.mjs";
// CI owns a fresh server; an explicit manual override may attach to a server already started on the selected port.
const port = browserPortRange(process.env.TRAIL_TEST_PORT ?? 4173, 1);
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: process.env.TRAIL_REUSE_SERVER === "1",
  },
  reporter: "list",
});
