import { test, expect, type Page } from "@playwright/test";

// The PRIVATE TEST MODE (TRAIL_ASSUME_ESTIMATED_CONNECTIONS=1 at build time) assumes estimated road-to-trail connections are
// traversable. Default builds are strict. The same synthetic route (a start 365 ft from the nearest mapped trail) is checked
// both ways: each test runs only in the build it describes.
const testMode = process.env.TRAIL_ASSUME_ESTIMATED_CONNECTIONS === "1";

async function planFromLocation(page: Page, latitude: number) {
  await page.addInitScript((latitude) => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(success: PositionCallback) {
          success({
            coords: { latitude, longitude: -88.95, accuracy: 5 },
            timestamp: Date.now(),
          } as GeolocationPosition);
          return 1;
        },
        clearWatch() {},
      },
    });
  }, latitude);
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
  await page.getByRole("button", { name: /^Destination:/ }).click();
  await page
    .getByRole("textbox", { name: "Search places" })
    .fill("Review trailhead · East");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Review trailhead · East/ })
    .click();
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
}
const start = (page: Page) =>
  page.getByRole("button", { name: "Start navigation", exact: true });

test("default build: no test banner, the estimated connection blocks Start", async ({
  page,
}) => {
  test.skip(testMode, "runs in the default (strict) build only");
  await planFromLocation(page, 40.489);
  await expect(page.getByText(/PRIVATE TEST MODE/)).toHaveCount(0);
  await expect(
    page.locator('.map-wrap[data-estimated-connections="1"]'),
  ).toHaveCount(1);
  await expect(start(page)).toBeDisabled();
});

test("private test mode: the route warning says estimated, the connection is still mapped, and Start works", async ({
  page,
}) => {
  test.skip(!testMode, "runs in the private test-mode build only");
  await planFromLocation(page, 40.489);
  await expect(page.locator(".test-mode-banner")).toHaveCount(0);
  // Nothing is relabelled as confirmed: the same measured, unverified connection is listed and drawn.
  await expect(
    page.locator('.map-wrap[data-estimated-connections="1"]'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("region", {
      name: "Route map with unverified connections",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /PRIVATE TEST MODE: this route includes 1 estimated connection/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/Verify the actual connection before riding/).first(),
  ).toBeVisible();
  await expect(start(page)).toBeEnabled();
  await start(page).click();
  await expect(
    page.getByRole("heading", { name: "Ride in progress", exact: true }),
  ).toBeVisible();
  // The ride screen keeps the assumption visible next to its large controls.
  await expect(page.locator(".ride-safety")).toContainText("PRIVATE TEST MODE");
  await expect(page.locator(".ride-safety")).toContainText(
    "Estimated connection: stop and verify it on the ground.",
  );
});

test("private test mode: a recalculated route with the same estimated connection can also start, and is still labelled", async ({
  page,
}) => {
  test.skip(!testMode, "runs in the private test-mode build only");
  await planFromLocation(page, 40.489);
  await page
    .getByRole("button", { name: "Recalculate route", exact: true })
    .click();
  await expect(
    page.locator('.map-wrap[data-estimated-connections="1"]'),
  ).toHaveCount(1);
  await expect(
    page.getByText(
      /PRIVATE TEST MODE: this route includes 1 estimated connection/,
    ),
  ).toBeVisible();
  await expect(start(page)).toBeEnabled();
});
