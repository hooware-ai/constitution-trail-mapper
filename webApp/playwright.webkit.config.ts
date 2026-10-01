import { defineConfig, devices } from "@playwright/test";
// Automated WebKit launch-acceptance coverage (issue #41). WebKit here is Playwright's own build of the Safari engine; it is
// NOT iPhone Safari, iOS, a physical device, VoiceOver or a real GPS. The Chromium suites (playwright.config.ts) are
// unchanged and keep running separately. Same rule as them: a port this run owns, never reused.
//   npm run test:webkit            (first use: npx playwright install webkit)
const port = Number(process.env.TRAIL_TEST_PORT ?? 4173);
export default defineConfig({
  testDir: "tests/webkit",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "webkit-iphone", use: { ...devices["iPhone 15"] } },
    // A small 320-point-wide screen: the narrowest layout the launch has to survive.
    { name: "webkit-iphone-se", use: { ...devices["iPhone SE"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  reporter: "list",
});
