import { test, expect, type Page } from "@playwright/test";

async function startLocation(page: Page) {
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let success: PositionCallback;
    let failure: PositionErrorCallback;
    let cleared = 0;
    let throws = false;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(next: PositionCallback, error: PositionErrorCallback) {
          if (throws) throw new Error("Provider failed to start");
          success = next;
          failure = error;
          return 7;
        },
        clearWatch() {
          cleared++;
        },
      },
    });
    (window as any).__plannerGps = {
      fix(accuracy = 5) {
        success({
          coords: { latitude: 40.51, longitude: -88.95, accuracy },
          timestamp: Date.now(),
        } as GeolocationPosition);
      },
      fail(code: number) {
        failure({ code } as GeolocationPositionError);
      },
      throwOnStart() {
        throws = true;
      },
      cleared: () => cleared,
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
});

for (const [code, message] of [
  [1, "Location access was blocked"],
  [2, "Your browser could not determine your location"],
  [3, "Your browser did not return a location in time"],
] as const) {
  test(`location error ${code} explains recovery and retries successfully`, async ({
    page,
  }) => {
    await startLocation(page);
    await page.evaluate(
      (code) => (window as any).__plannerGps.fail(code),
      code,
    );
    await expect(page.getByRole("alert")).toContainText(message);
    await page
      .getByRole("button", { name: "Try location again", exact: true })
      .click();
    await page.evaluate(() => (window as any).__plannerGps.fix());
    await expect(
      page.getByRole("button", {
        name: "Start: Current location",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("a coarse reading can improve and a late result cannot replace a manual place", async ({
  page,
}) => {
  await startLocation(page);
  await page.evaluate(() => (window as any).__plannerGps.fix(200));
  await expect(
    page.getByRole("status").filter({ hasText: "Location found" }),
  ).toContainText("200 m");
  await expect(
    page.getByRole("button", { name: "Start: Current location", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => (window as any).__plannerGps.fix(10));
  await expect(
    page.getByRole("button", { name: "Start: Current location", exact: true }),
  ).toBeVisible();
  await startLocation(page);
  await page
    .getByRole("button", { name: "Choose a place", exact: true })
    .click();
  await page.getByRole("button", { name: /^Review trailhead · West/ }).click();
  await page.evaluate(() => (window as any).__plannerGps.fix());
  await expect(
    page.getByRole("button", {
      name: "Start: Review trailhead · West",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__plannerGps.cleared()),
  ).toBe(2);
});

test("a missing browser callback times out and offers map selection", async ({
  page,
}, info) => {
  await page.clock.install();
  await startLocation(page);
  await page.clock.fastForward(20_001);
  await expect(page.getByRole("alert")).toContainText(
    "Your browser did not return a location in time",
  );
  await page.screenshot({
    path: `output/playwright/location-recovery-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Pick on map", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose start on the map", exact: true }),
  ).toBeVisible();
});

test("a synchronous browser failure releases the location request", async ({
  page,
}) => {
  await page.evaluate(() => (window as any).__plannerGps.throwOnStart());
  await startLocation(page);
  await expect(page.getByRole("alert")).toContainText(
    "Location could not start",
  );
  await expect(
    page.getByRole("button", { name: "Cancel location request", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Try location again", exact: true }),
  ).toBeVisible();
});
