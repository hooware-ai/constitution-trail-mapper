import { defineConfig, devices } from "@playwright/test";
import { browserPortRange } from "./tools/lib/browser-port.mjs";

// Fast, synthetic trip replay. This drives the real web app, worker and Kotlin
// router with a scripted browser location provider; it does not emulate an OS
// GPS, phone lock screen, outdoor accuracy or accessibility service.
const port = browserPortRange(process.env.TRAIL_TEST_PORT ?? 4173, 1);
export default defineConfig({
  testDir: "tests/replay",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "replay-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "replay-phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  reporter: "list",
});
