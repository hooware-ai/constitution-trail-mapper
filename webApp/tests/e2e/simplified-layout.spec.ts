import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The simplification pass: the map, the route and the Start action lead; repeated copy is gone; the safety information
// (closure status, foreground-only note, estimated connections) is still there, once. Runs at desktop and phone sizes.
async function withGps(page: Page) {
  await page.addInitScript(() => {
    const watches = new Map<
      number,
      { s: PositionCallback; e?: PositionErrorCallback }
    >();
    let id = 0;
    let visible = true;
    Object.defineProperty(document, "visibilityState", {
      get: () => (visible ? "visible" : "hidden"),
    });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(s: PositionCallback, e?: PositionErrorCallback) {
          watches.set(++id, { s, e });
          return id;
        },
        clearWatch(k: number) {
          watches.delete(k);
        },
        getCurrentPosition(s: PositionCallback) {
          s({
            coords: { latitude: 40.51, longitude: -88.95, accuracy: 5 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
    (window as any).__gps = {
      fix(lat: number, lon: number) {
        for (const w of watches.values())
          w.s({
            coords: { latitude: lat, longitude: lon, accuracy: 5 },
            timestamp: Date.now(),
          } as GeolocationPosition);
      },
      visible(v: boolean) {
        visible = v;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    };
  });
}
async function choose(
  page: Page,
  field: "Start" | "Destination",
  name: string,
) {
  await page
    .getByRole("button", { name: new RegExp("^" + field + ":") })
    .click();
  await page.getByRole("textbox", { name: "Search places" }).fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(name) })
    .click();
}
async function plan(page: Page) {
  await withGps(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
}
const start = (page: Page) =>
  page.getByRole("button", { name: "Start navigation", exact: true });

test("the preview leads with the route and a reachable Start, and says each thing once", async ({
  page,
}) => {
  await plan(page);
  await expect(start(page)).toBeEnabled();
  // Start is reachable without scrolling the page: inside the first screen at this size.
  const box = await start(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  // The map is a large part of the screen.
  const map = await page.locator(".map-wrap").boundingBox();
  expect(map!.width * map!.height).toBeGreaterThan(
    viewport.width * viewport.height * 0.2,
  );
  // Said once: the foreground-only note and the closure status.
  await expect(page.locator("#foreground-note")).toHaveCount(1);
  await expect(page.getByText(/Foreground navigation only/)).toHaveCount(0);
  await expect(page.getByText(/Known closure catalog checked/)).toHaveCount(1);
  // The long machine sentence is for screen readers only.
  await expect(
    page.locator("p.visually-hidden", { hasText: /Trail route found:/ }),
  ).toHaveCount(1);
  await expect(page.getByText("Ready when you are")).toHaveCount(0);
  // Secondary actions are all still present.
  for (const name of ["Share", "Edit", "Directions", "Recalculate route"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("navigation says its one caption once, survives an interruption and can be started again", async ({
  page,
}) => {
  await plan(page);
  for (let ride = 1; ride <= 2; ride++) {
    await start(page).click();
    await expect(
      page.getByRole("heading", { name: "Reacquiring location…" }),
    ).toBeVisible();
    await page.evaluate(() => (window as any).__gps.fix(40.505, -88.95));
    await expect(page.locator(".guidance.navigating")).toBeVisible();
    await expect(
      page.getByText(/Guidance pauses when the page is hidden/),
    ).toHaveCount(1);
    await expect(page.getByText(/Keep this page open and visible/)).toHaveCount(
      1,
    );
    // Interruption and recovery.
    await page.evaluate(() => (window as any).__gps.visible(false));
    await expect(
      page.getByRole("heading", { name: "Navigation paused", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => (window as any).__gps.visible(true));
    await expect(
      page.getByRole("heading", { name: "Reacquiring location…" }),
    ).toBeVisible();
    await page.evaluate(() => (window as any).__gps.fix(40.5, -88.95));
    await expect(page.locator(".guidance.navigating")).toBeVisible();
    if (ride === 1) {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    }
    await page.getByRole("button", { name: "Stop navigation" }).last().click();
    await expect(
      page.getByRole("heading", { name: "Route preview", exact: true }),
    ).toBeVisible();
    await expect(start(page)).toBeEnabled();
  }
});
