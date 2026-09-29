import { test, expect, type Page } from "@playwright/test";

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
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeDisabled();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
}
test("point route, full preview, directions, saved/place persistence and private sharing", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await plan(page);
  await expect(
    page.getByRole("region", { name: "Complete route map" }),
  ).toBeVisible();
  await expect(page.getByText("1.4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Directions" })).toBeVisible();
  await expect(page.getByRole("dialog").locator("ol li").first()).toBeVisible();
  await page.getByRole("button", { name: "Close Directions" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved · View" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save destination as a place" })
    .click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await expect(dialog).toContainText("Exact start and destination");
  await expect(dialog.locator(".share-preview")).not.toContainText(
    "Review trailhead",
  );
  await expect(dialog.locator(".share-preview")).not.toContainText("-88.");
  await page.getByRole("button", { name: "Close Share route" }).click();
  await page.getByRole("button", { name: "Saved · View" }).click();
  await expect(
    page.getByRole("heading", { name: "Saved places", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Rename Review trailhead · East/ })
    .click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Afternoon trail ride");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Afternoon trail ride/ }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Recent · 0" }).click();
  await expect(
    page.getByRole("heading", { name: "No recent routes" }),
  ).toBeVisible();
  expect(failures).toEqual([]);
});
test("issue 29 selected Start controls destination ranking; unresolved input stays unresolved", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Destination:/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    /Bloomington|local-area|unresolved|no resolved/i,
  );
  await page.getByRole("textbox", { name: "Search places" }).fill("Culver's");
  await expect(
    page.getByRole("dialog").locator(".place-results button"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Close Choose destination" }).click();
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeDisabled();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: /^Destination:/ }).click();
  await page.getByRole("textbox", { name: "Search places" }).fill("Culver's");
  await expect(
    page.getByRole("dialog").locator(".place-results button").first(),
  ).toContainText("Hershey");
  await expect(
    page.getByRole("dialog").locator(".place-results button").first(),
  ).toContainText("901");
  await page.getByRole("button", { name: "Close Choose destination" }).click();
  await choose(page, "Start", "Review trailhead · West");
  await page.getByRole("button", { name: /^Destination:/ }).click();
  await page.getByRole("textbox", { name: "Search places" }).fill("Culver's");
  await expect(
    page.getByRole("dialog").locator(".place-results button").first(),
  ).toContainText("West Market");
});
test("exercise validation, recent route retention UI, proposed opt in and map selection", async ({
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
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "See all", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear recents", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No recent routes" }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  const proposed = page.getByRole("checkbox", { name: /Show proposed trails/ });
  await expect(proposed).not.toBeChecked();
  await proposed.check();
  await expect(proposed).toBeChecked();
  await page.getByRole("button", { name: "Plan a ride", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /Include proposed trails/ }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page.getByRole("button", { name: "Pick on map", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use map center" }),
  ).toBeVisible();
  const pickerMap = await page
    .getByRole("region", { name: "Trail network map", exact: true })
    .boundingBox();
  expect(pickerMap?.width).toBeGreaterThan(250);
  expect(
    await page
      .locator(".app")
      .evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual((page.viewportSize()?.width ?? 0) - 1);
  await page.getByRole("button", { name: "Use map center" }).click();
  await expect(page.getByRole("button", { name: /^Start:/ })).not.toContainText(
    "Choose a place",
  );
});

test.beforeEach(async ({ page }) => {
  // Deterministic browser adapter only: the worker and Kotlin router remain real.
  await page.addInitScript(() => {
    let id = 0,
      visible = true;
    const watches = new Map<
      number,
      { success: PositionCallback; error?: PositionErrorCallback | null }
    >();
    Object.defineProperty(document, "visibilityState", {
      get: () => (visible ? "visible" : "hidden"),
    });
    Object.defineProperty(document, "hidden", { get: () => !visible });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(
          success: PositionCallback,
          error?: PositionErrorCallback,
        ) {
          watches.set(++id, { success, error });
          return id;
        },
        clearWatch(key: number) {
          watches.delete(key);
        },
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: { latitude: 40.51, longitude: -88.95, accuracy: 5 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
    (window as any).__gps = {
      fix(latitude: number, longitude: number, accuracy = 5, age = 0) {
        for (const w of watches.values())
          w.success({
            coords: { latitude, longitude, accuracy },
            timestamp: Date.now() - age,
          } as GeolocationPosition);
      },
      failure() {
        for (const w of watches.values())
          w.error?.({
            code: 2,
            message: "simulated loss",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
      },
      visible(value: boolean) {
        visible = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      watches: () => watches.size,
    };
  });
});
async function fix(
  page: Page,
  lat: number,
  lon: number,
  accuracy = 5,
  age = 0,
) {
  await page.evaluate(
    ({ lat, lon, accuracy, age }) =>
      (window as any).__gps.fix(lat, lon, accuracy, age),
    { lat, lon, accuracy, age },
  );
}
test("foreground navigation hides stale guidance, resumes after reload, rejects inaccurate/stale fixes and network loss is explicit", async ({
  page,
  context,
}) => {
  await plan(page);
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await fix(page, 40.51, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await page.evaluate(() => (window as any).__gps.visible(false));
  await expect(
    page.getByRole("heading", { name: "Navigation paused", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__gps.visible(true));
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await fix(page, 40.505, -88.95, 150);
  await expect(
    page.getByRole("heading", { name: "Waiting for location", exact: true }),
  ).toBeVisible();
  await fix(page, 40.505, -88.95, 5, 60000);
  await expect(page.locator(".guidance.navigating")).not.toBeVisible();
  await fix(page, 40.505, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await expect(page.getByText(/0.0 mi observed this ride/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await fix(page, 40.502, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await context.setOffline(true);
  await expect(page.locator(".offline-banner")).toBeVisible();
  await page.evaluate(() => (window as any).__gps.failure());
  await expect(
    page.getByRole("heading", { name: "Waiting for location", exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
});
test("mobile layout has no horizontal overflow and dialogs support keyboard dismissal", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.evaluate(() => (document.documentElement.style.fontSize = "24px"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

async function acceptedFix(page: Page, lat: number, lon: number) {
  const timestamp = await page.evaluate(
    ({ lat, lon }) => {
      const now = Date.now();
      (window as any).__gps.fix(lat, lon, 5, 0);
      return now;
    },
    { lat, lon },
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) =>
          k.endsWith("trail-mapper.web.active-ride.v1"),
        );
        return key ? JSON.parse(localStorage.getItem(key)!).updatedAt : 0;
      }),
    )
    .toBeGreaterThanOrEqual(timestamp);
}
test("native sustained departure offers a usable mapped reroute", async ({
  page,
}) => {
  await page.clock.install();
  await plan(page);
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await acceptedFix(page, 40.51, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.509, -88.96);
  await expect(
    page.getByText("Checking whether you are off route…"),
  ).toBeVisible();
  await page.clock.fastForward(8000);
  await acceptedFix(page, 40.5085, -88.96);
  await page.clock.fastForward(8000);
  await acceptedFix(page, 40.508, -88.96);
  await expect(
    page.getByRole("heading", { name: "You are off route", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reroute", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.508, -88.96);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
});

for (const choice of ["Rejoin the loop", "Return to start"])
  test(
    "exercise off route offers " + choice + " with mapped replacement",
    async ({ page }) => {
      await page.clock.install();
      await page.goto("/");
      await page.getByRole("button", { name: /Make an exercise loop/ }).click();
      await choose(page, "Start", "Review trailhead · East");
      await page.getByRole("button", { name: "3 mi", exact: true }).click();
      await page
        .getByRole("button", { name: "Make loop", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Route preview" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Start navigation", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Reacquiring location…",
          exact: true,
        }),
      ).toBeVisible();
      await acceptedFix(page, 40.51, -88.95);
      await expect(page.locator(".guidance.navigating")).toBeVisible();
      await page.clock.fastForward(1000);
      await acceptedFix(page, 40.491, -88.99);
      await expect(
        page.getByText("Checking whether you are off route…"),
      ).toBeVisible();
      await page.clock.fastForward(8000);
      await acceptedFix(page, 40.492, -88.99);
      await page.clock.fastForward(8000);
      await acceptedFix(page, 40.493, -88.99);
      await expect(
        page.getByRole("button", { name: "Rejoin the loop", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Return to start", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: choice, exact: true }).click();
      if (choice === "Return to start")
        await expect(
          page.getByRole("heading", {
            name: "Returning to start",
            exact: true,
          }),
        ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Reacquiring location…",
          exact: true,
        }),
      ).toBeVisible();
    },
  );

test("planner and preview survive reload with resolved endpoints and fresh closure check", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Start: Review trailhead · East",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeDisabled();
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(/Known closure catalog checked/)).toBeVisible();
});

test("accessible landmark controls and route preview", async ({
  page,
}, info) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "output/playwright/route-preview-" + info.project.name + ".png",
    fullPage: true,
  });
});

test("current location resolves explicitly, endpoint swap works, and zero-length rides show a recoverable error", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
  await page.evaluate(() => (window as any).__gps.fix(40.51, -88.95));
  await expect(
    page.getByRole("button", { name: "Start: Current location", exact: true }),
  ).toBeVisible();
  await choose(page, "Destination", "Review trailhead · East");
  await page
    .getByRole("button", { name: "Swap start and destination", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Destination: Current location",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    /No |safe|route|distinct/i,
  );
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).not.toBeVisible();
});

test("missing local data fails visibly and can retry without silently using fixtures", async ({
  page,
}) => {
  await page.route("**/local-review-data", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/?data=local");
  await expect(page.getByRole("alert")).toContainText(
    /Local data is unavailable/,
  );
  await expect(
    page.getByRole("button", { name: "Retry loading", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).not.toBeVisible();
});

test("an exercise loop keeps its progress when the page is hidden and shown, and after a reload", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: "3 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  const ride = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.endsWith("trail-mapper.web.active-ride.v1"),
      );
      return key ? JSON.parse(localStorage.getItem(key)!) : null;
    });
  // Ride the stored route geometry about 80% of the way round, on its return leg.
  const path = await (async () => {
    await acceptedFix(page, 40.51, -88.95);
    const stored = await ride();
    return (stored.record.route.segments as any[]).flatMap((s) =>
      (s.points as { latitude: number; longitude: number }[]).map((p) => [
        p.latitude,
        p.longitude,
      ]),
    );
  })();
  const stepEvery = Math.max(1, Math.floor(path.length / 60));
  const target = Math.floor(path.length * 0.8);
  for (let index = stepEvery; index <= target; index += stepEvery) {
    await page.clock.fastForward(1000);
    await acceptedFix(page, path[index][0], path[index][1]);
  }
  const [lat, lon] = path[target];
  await page.clock.fastForward(1000);
  await acceptedFix(page, lat, lon);
  const before = (await ride()).routeProgressMeters as number;
  expect(before).toBeGreaterThan(1500);
  // Hide, then show, and reacquire at the identical place: progress must not fall back to an earlier pass.
  await page.evaluate(() => (window as any).__gps.visible(false));
  await page.clock.fastForward(30_000);
  await page.evaluate(() => (window as any).__gps.visible(true));
  await page.clock.fastForward(1000);
  await acceptedFix(page, lat, lon);
  const afterShow = (await ride()).routeProgressMeters as number;
  expect(afterShow).toBeGreaterThanOrEqual(before - 60);
  // Same after a reload.
  await page.reload();
  await page.clock.fastForward(1000);
  await acceptedFix(page, lat, lon);
  const afterReload = (await ride()).routeProgressMeters as number;
  expect(afterReload).toBeGreaterThanOrEqual(before - 60);
});

async function seedOutAndBackRide(page: Page, progress: number) {
  await page.clock.install();
  await page.addInitScript((progress) => {
    const key = "trail-mapper.fixture:trail-mapper.web.active-ride.v1";
    if (localStorage.getItem(key)) return;
    const north = (meters: number) => ({
      latitude: 40.5 + meters / 111_195,
      longitude: -88.95,
    });
    const segment = (points: { latitude: number; longitude: number }[]) => ({
      type: "Trail",
      points,
      isRouted: true,
    });
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        record: {
          key: "out-and-back",
          title: "Out and back",
          createdAt: Date.now(),
          usedAt: Date.now(),
          route: {
            segments: [
              segment([north(0), north(1000), north(2000)]),
              segment([north(2000), north(1000), north(0)]),
            ],
            totalDistanceMeters: 4000,
            ordinaryAccessDistanceMeters: 0,
            totalCost: 1,
            kind: "ExerciseLoop",
          },
          draft: {
            mode: "loop",
            start: { label: "Trailhead", ...north(0) },
            destination: null,
            miles: 3,
            proposed: false,
          },
        },
        routeProgressMeters: progress,
        creditedDistanceMeters: 2000,
        updatedAt: Date.now(),
      }),
    );
  }, progress);
}
test("reloading on the return leg of an out-and-back loop keeps the return pass", async ({
  page,
}) => {
  await seedOutAndBackRide(page, 3000);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  // The rider is back at the 1 km mark, which the outbound pass also passes through.
  await acceptedFix(page, 40.5 + 1000 / 111_195, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith("trail-mapper.web.active-ride.v1"),
    );
    return JSON.parse(localStorage.getItem(key!)!);
  });
  expect(stored.routeProgressMeters).toBeGreaterThan(2900);
  expect(stored.routeProgressMeters).toBeLessThan(3100);
  // Unobserved movement is never credited.
  expect(stored.creditedDistanceMeters).toBe(2000);
});

test("moving toward the start on the return pass during a gap continues on the return pass", async ({
  page,
}) => {
  await seedOutAndBackRide(page, 3000);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  // 500 m north: the outbound pass (500 m along) and the return pass (3500 m along) both match.
  await acceptedFix(page, 40.5 + 500 / 111_195, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith("trail-mapper.web.active-ride.v1"),
    );
    return JSON.parse(localStorage.getItem(key!)!);
  });
  expect(stored.routeProgressMeters).toBeGreaterThan(3400);
  expect(stored.creditedDistanceMeters).toBe(2000);
});
test("a position that only matches an earlier pass is ambiguous, not guidance or off route", async ({
  page,
}) => {
  await seedOutAndBackRide(page, 3200);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  await fix(page, 40.5 + 1000 / 111_195, -88.95);
  await expect(
    page.getByText("We can't tell where you are on the loop"),
  ).toBeVisible();
  await expect(page.locator(".guidance.navigating")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "You are off route" }),
  ).toHaveCount(0);
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith("trail-mapper.web.active-ride.v1"),
    );
    return JSON.parse(localStorage.getItem(key!)!);
  });
  expect(stored.routeProgressMeters).toBe(3200);
  expect(stored.creditedDistanceMeters).toBe(2000);
});
