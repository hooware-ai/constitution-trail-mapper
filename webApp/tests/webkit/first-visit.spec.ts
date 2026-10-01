// First-visit guest journey on WebKit (issue #41). Today's behavior: no sign-in, saves stay in this browser. These specs do
// not call local saves "cloud" saves and do not exercise any account flow. Labels in the titles are explained in support.ts.
import { test, expect } from "@playwright/test";
import {
  choose,
  fitsWidth,
  fix,
  openPlanner,
  planFromCurrentLocation,
  planPoint,
  simulateDevice,
  startButton,
} from "./support";

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  (page as any).__errors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as any).__errors).toEqual([]);
});

test("[engine] a first opening has no stored data, offers the guest actions, and the routing worker starts", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Make an exercise loop/ }),
  ).toBeVisible();
  // Nothing of ours is stored before the rider does something.
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.includes("trail-mapper")),
  );
  expect(keys.filter((key) => /saved|recent|ride|session/.test(key))).toEqual(
    [],
  );
  // Truthful local-only wording, and no sign-in controls, on the first screen.
  await expect(page.locator("body")).toContainText(
    "On this browser · no account",
  );
  await expect(page.locator("body")).toContainText(
    "Saved routes and places stay in this browser. No sign-in or cloud sync.",
  );
  await expect(
    page.getByRole("button", {
      name: /sign in|log in|google|apple|create an account/i,
    }),
  ).toHaveCount(0);
  expect(await fitsWidth(page)).toBe(true);
  // The module worker (real Kotlin router) answers: planning a route below proves it too.
  const workers = await page.evaluate(() => typeof Worker === "function");
  expect(workers).toBe(true);
});

test("[engine] Explore shows the trail map, closures are not hidden, and proposed trails are off until the rider opts in", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Trail network map", exact: true }),
  ).toBeVisible();
  const proposed = page.getByRole("checkbox", { name: /Show proposed trails/ });
  await expect(proposed).not.toBeChecked();
  await proposed.check();
  await expect(proposed).toBeChecked();
  expect(
    await page
      .locator(".leaflet-container")
      .first()
      .evaluate((el) => el.clientHeight),
  ).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Plan a ride", exact: true }).click();
  // The opt-in is not carried silently into planning.
  await expect(
    page.getByRole("checkbox", { name: /Include proposed trails/ }),
  ).not.toBeChecked();
});

test("[engine] point-to-point planning: preview, directions, the foreground limit and an enabled Start", async ({
  page,
}) => {
  await planPoint(page);
  await expect(
    page.getByRole("region", { name: "Complete route map" }),
  ).toBeVisible();
  await expect(page.getByText("1.4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Directions" })).toBeVisible();
  await expect(page.getByRole("dialog").locator("ol li").first()).toBeVisible();
  await page.getByRole("button", { name: "Close Directions" }).click();
  const note = page.locator("#foreground-note");
  await expect(note).toContainText(
    "Keep this page open and visible while you ride",
  );
  await expect(startButton(page)).toBeEnabled();
  await expect(startButton(page)).toHaveAttribute(
    "aria-describedby",
    "foreground-note",
  );
});

test("[engine] an exercise loop is validated, planned and previewed", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("spinbutton", { name: "Custom miles" }).fill("0.1");
  await expect(
    page.getByRole("button", { name: "Make loop", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "5 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Complete route map" }),
  ).toBeVisible();
});

test("[sim-device] a route with an unverified connection explains it at the decision point and blocks navigation; a fully mapped route does not", async ({
  page,
}) => {
  await simulateDevice(page);
  await planFromCurrentLocation(page);
  await fix(page, 40.489, -88.95);
  await page.getByRole("button", { name: /^Destination:/ }).click();
  await page
    .getByRole("textbox", { name: "Search places" })
    .fill("Review trailhead · East");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Review trailhead · East/ })
    .click();
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  const details = page.getByRole("region", { name: "1 connection to check" });
  await expect(details).toContainText("365 ft");
  await expect(startButton(page)).toBeDisabled();
  await expect(
    page.getByRole("region", {
      name: "Route map with unverified connections",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/ready to navigate/i)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Recalculate route", exact: true })
    .click();
  await expect(
    page.getByText("Route recalculated", { exact: true }),
  ).toBeVisible();
});

test("[sim-device] a fully mapped route from the current location has no connection warning and can start", async ({
  page,
}) => {
  await simulateDevice(page);
  await planFromCurrentLocation(page);
  await fix(page, 40.49, -88.95);
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
  await expect(
    page.getByRole("region", { name: /connections? to check/ }),
  ).toHaveCount(0);
  await expect(startButton(page)).toBeEnabled();
});

test("[sim-device] denied or unavailable location keeps map and manual planning working", async ({
  page,
}) => {
  await simulateDevice(page);
  await planFromCurrentLocation(page);
  await page.evaluate(() => (window as any).__device.fail(1));
  await expect(page.getByText(/Location access was blocked/)).toBeVisible();
  // Manual planning still works: choose both ends by name.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page
    .getByRole("textbox", { name: "Search places" })
    .fill("Review trailhead · East");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Review trailhead · East/ })
    .click();
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(startButton(page)).toBeEnabled();
});

test("[sim-device] unavailable and timed-out location offer the map picker instead of a dead end", async ({
  page,
}) => {
  await simulateDevice(page);
  await planFromCurrentLocation(page);
  await page.evaluate(() => (window as any).__device.fail(2));
  await expect(
    page.getByText(/could not determine your location/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pick on map", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pick on map", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use map center" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use map center" }).click();
  await expect(page.getByRole("button", { name: /^Start:/ })).not.toContainText(
    "Choose a place",
  );
});

test.describe("engine geolocation", () => {
  // Permission and position are given when the context is created: the engine only answers a page's request that way
  // under Playwright's WebKit.
  test.use({
    permissions: ["geolocation"],
    geolocation: { latitude: 40.49, longitude: -88.95, accuracy: 5 },
  });
  test("[engine-geo] the engine's own geolocation API answers; the app takes a plausible fix and refuses one whose timestamp is not", async ({
    page,
  }, info) => {
    await openPlanner(page);
    // What the engine reports (Playwright's WebKit provider is a harness, not a GPS).
    const reading = await page.evaluate(
      () =>
        new Promise<{ accuracy: number; skewMs: number } | string>((done) =>
          navigator.geolocation.getCurrentPosition(
            (position) =>
              done({
                accuracy: position.coords.accuracy,
                skewMs: Date.now() - position.timestamp,
              }),
            (error) => done(`error ${error.code}`),
            { timeout: 8000 },
          ),
        ),
    );
    expect(typeof reading).toBe("object");
    const skew = (reading as { skewMs: number }).skewMs;
    const plausible = Math.abs(skew) < 60_000;
    info.annotations.push({
      type: "provider-timestamp",
      description: plausible
        ? "milliseconds, plausible"
        : `implausible (Date.now() - timestamp = ${skew}); Playwright's WebKit provider reports microseconds`,
    });
    await page.getByRole("button", { name: /^Start:/ }).click();
    await page
      .getByRole("button", { name: "Use current location", exact: true })
      .click();
    if (plausible) {
      await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
        "Current location",
        { timeout: 20000 },
      );
    } else {
      // The app must not accept a fix it cannot date: it keeps waiting and map selection stays available.
      await expect(page.getByText(/Getting your location/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Pick on map", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
        "Choose a place",
      );
    }
  });
});

test("[engine] Save keeps the route in this browser only, survives a reload, and sharing and Help say what leaves the page", async ({
  page,
}) => {
  await planPoint(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved · View" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share route" });
  await expect(share).toContainText("Exact start and destination");
  await expect(share.locator(".share-preview")).not.toContainText(
    "Review trailhead",
  );
  await expect(share.locator(".share-preview")).not.toContainText("-88.");
  await page.getByRole("button", { name: "Close Share route" }).click();

  await page.reload();
  // A reload restores the route preview (by design); go home to reach the Saved tab.
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Review trailhead/ }).first(),
  ).toBeVisible();
  // Nothing about this is presented as an account or cloud save.
  await expect(page.locator("body")).not.toContainText(
    /synced|saved to (the )?cloud|your account/i,
  );

  await page.getByRole("button", { name: /^Help/ }).first().click();
  const help = page.getByRole("dialog", { name: "Help and about" });
  await expect(help).toContainText(
    "only while this page stays open and visible",
  );
  await expect(help).toContainText("not a live feed");
  await expect(help).toContainText("Unverified connection");
  await expect(help).toContainText("Do not ride it");
  await page.keyboard.press("Escape");
  await expect(help).not.toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
});
