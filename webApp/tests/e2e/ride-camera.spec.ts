import { test, expect, type Page } from "@playwright/test";

async function planRide(page: Page) {
  await page.addInitScript(() => {
    const watches = new Map<
      number,
      { success: PositionCallback; error?: PositionErrorCallback }
    >();
    let nextId = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition(
          success: PositionCallback,
          error?: PositionErrorCallback,
        ) {
          const id = ++nextId;
          watches.set(id, { success, error });
          return id;
        },
        clearWatch(id: number) {
          watches.delete(id);
        },
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: { latitude: 40.51, longitude: -88.95, accuracy: 5 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
    (window as any).__rideGps = {
      fix(
        latitude: number,
        longitude: number,
        heading: number | null,
        speed: number | null,
      ) {
        for (const watch of watches.values())
          watch.success({
            coords: { latitude, longitude, accuracy: 5, heading, speed },
            timestamp: Date.now(),
          } as GeolocationPosition);
      },
      fail(code: number) {
        for (const watch of watches.values())
          watch.error?.({ code } as GeolocationPositionError);
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  for (const [field, name] of [
    ["Start", "East"],
    ["Destination", "South"],
  ] as const) {
    await page.getByRole("button", { name: new RegExp(`^${field}:`) }).click();
    await page.getByRole("textbox", { name: "Search places" }).fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(`Review trailhead.*${name}`) })
      .click();
  }
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
}

async function startRide(page: Page) {
  await planRide(page);
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(page.locator(".ride-ui")).toBeVisible();
}

test("the phone home keeps the map and ride choices in one view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const choice = page.getByRole("button", { name: /Go somewhere/ });
  await expect(choice).toBeVisible();
  const box = (await choice.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(568);
  await page.screenshot({ path: "test-results/home-mobile-320.png" });
});

test("planning remains usable at small phone sizes", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await planRide(page);
  const start = (await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .boundingBox())!;
  expect(start.y + start.height).toBeLessThanOrEqual(568);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.screenshot({ path: "test-results/preview-mobile-320.png" });
});

test("phone ride screen follows a reliable heading, pauses for pan and recenters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startRide(page);
  const map = page.locator(".ride-map");
  await expect(map).toBeVisible();
  await page.evaluate(() =>
    (window as any).__rideGps.fix(40.505, -88.95, null, 0),
  );
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-camera-mode",
    "north-up",
  );
  await page.evaluate(() =>
    (window as any).__rideGps.fix(40.505, -88.95, 90, 4),
  );
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-camera-mode",
    "heading-up",
  );
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-camera-bearing",
    "90",
  );
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-camera-pitch",
    "48",
  );
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-actual-bearing",
    "90",
  );
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-actual-pitch",
    "48",
  );
  await page.screenshot({ path: "test-results/ride-mobile-390.png" });
  const box = (await page.locator(".ride-map-canvas").boundingBox())!;
  expect(box.height).toBeGreaterThan(700);
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 3 + 55,
    box.y + box.height / 2 + 35,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect(map).toHaveAttribute("data-following", "false");
  await page.getByRole("button", { name: "Recenter" }).click();
  await expect(map).toHaveAttribute("data-following", "true");
  await expect(
    page.getByRole("button", { name: "Stop navigation" }),
  ).toBeVisible();
});

test("loss of GPS clears live guidance and the ride can end", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await startRide(page);
  await page.evaluate(() =>
    (window as any).__rideGps.fix(40.505, -88.95, 0, 4),
  );
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-actual-pitch",
    "48",
  );
  await page.screenshot({ path: "test-results/ride-mobile-320.png" });
  await page.evaluate(() => (window as any).__rideGps.fail(2));
  await expect(
    page.getByRole("heading", { name: "Location lost" }),
  ).toBeVisible();
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-camera-mode",
    "waiting",
  );
  await page.evaluate(() =>
    (window as any).__rideGps.fix(40.505, -88.95, 0, 4),
  );
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-camera-mode",
    "heading-up",
  );
  await page.evaluate(() => (window as any).__rideGps.fail(1));
  await expect(
    page.getByRole("heading", { name: "Location blocked" }),
  ).toBeVisible();
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-camera-mode",
    "waiting",
  );
  await page.getByRole("button", { name: "Stop navigation" }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
});

test("ride controls stay on screen across phone widths and large text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await startRide(page);
  await page.evaluate(() =>
    (window as any).__rideGps.fix(40.505, -88.95, 90, 4),
  );
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 740 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "175%";
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    for (const name of ["Directions", "Stop navigation"]) {
      const button = page.getByRole("button", { name });
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(740);
    }
  }
});
