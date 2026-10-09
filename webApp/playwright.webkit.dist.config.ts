import { defineConfig, devices } from "@playwright/test";
import { browserPortRange } from "./tools/lib/browser-port.mjs";
import { checkDistExpectations } from "./tools/lib/dist-expectations.mjs";
const port = browserPortRange(process.env.TRAIL_TEST_PORT ?? 4176, 1);
checkDistExpectations();
export default defineConfig({
  testDir: "tests/webkit-dist",
  outputDir: "test-results/webkit-dist",
  globalSetup: "./tests/support/check-dist-server.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "webkit-iphone", use: { ...devices["iPhone 15"] } },
    { name: "webkit-iphone-se", use: { ...devices["iPhone SE"] } },
  ],
  webServer: {
    command: `node tools/serve-dist.mjs --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  reporter: "list",
});
