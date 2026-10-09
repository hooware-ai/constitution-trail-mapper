import { test, expect, type Page } from "@playwright/test";

const county = process.env.TRAIL_EXPECT_DATASET === "county";
const privateMode = process.env.TRAIL_ASSUME_ESTIMATED_CONNECTIONS === "1";

async function planCatalogRoute(page: Page) {
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  for (const [field, name] of [
    ["Start", "Tipton Park"],
    ["Destination", "Hershey Road"],
  ] as const) {
    await page.getByRole("button", { name: new RegExp(`^${field}:`) }).click();
    await page.getByRole("textbox", { name: "Search places" }).fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(name, "i") })
      .click();
  }
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    page.locator(".map-wrap[data-estimated-connections]"),
  ).not.toHaveAttribute("data-estimated-connections", "0");
}

test("a real catalog trip reaches the ride camera without hiding estimated access", async ({
  page,
  request,
}) => {
  test.skip(
    !county || !privateMode,
    "requires the private county review artifact",
  );
  const errors: string[] = [];
  const tileRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("tile.openstreetmap.org"))
      tileRequests.push(request.url());
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition(success: PositionCallback) {
          (window as any).__realRideFix = () =>
            success({
              coords: {
                latitude: 40.5092876306785,
                longitude: -88.92688066101174,
                accuracy: 5,
                heading: 90,
                speed: 4,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
          return 1;
        },
        clearWatch() {},
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Go somewhere/ })).toBeVisible({
    timeout: 30_000,
  });
  const record = await (await request.get("/data/dataset.json")).json();
  expect(record.content.sha256).toBe(
    "903e43cf077acf79988920eb114b02e0f90bab022180aca88f5205c7a1ed882d",
  );
  expect(record.approval.approved).toBe(false);
  await planCatalogRoute(page);
  await page.screenshot({ path: "test-results/real-county-preview-390.png" });
  const start = page.getByRole("button", {
    name: "Start navigation",
    exact: true,
  });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator(".ride-map-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".ride-safety")).toContainText("PRIVATE TEST MODE");
  await expect(page.locator(".ride-safety")).toContainText(
    "Estimated connection",
  );
  await page.evaluate(() => (window as any).__realRideFix());
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-camera-mode",
    "heading-up",
  );
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-actual-pitch",
    "48",
  );
  await page.screenshot({ path: "test-results/real-county-ride-390.png" });
  expect(tileRequests).toEqual([]);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Stop navigation" }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
});

test("the same real route cannot Start when the estimated connection assumption is off", async ({
  page,
  request,
}) => {
  test.skip(
    !county || privateMode,
    "requires the strict county review artifact",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Go somewhere/ })).toBeVisible({
    timeout: 30_000,
  });
  const record = await (await request.get("/data/dataset.json")).json();
  expect(record.content.sha256).toBe(
    "903e43cf077acf79988920eb114b02e0f90bab022180aca88f5205c7a1ed882d",
  );
  await planCatalogRoute(page);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".test-mode-banner")).toHaveCount(0);
  await expect(page.locator(".ride-map, .ride-map-fallback")).toHaveCount(0);
});
