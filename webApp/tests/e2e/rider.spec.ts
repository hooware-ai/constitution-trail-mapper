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

type SeedSegment = {
  type: "Trail" | "Access";
  from: number;
  to: number;
  routed?: boolean;
  roles?: string[];
};
async function seedSavedRoute(
  page: Page,
  title: string,
  segments: SeedSegment[],
) {
  await page.addInitScript(
    ({ title, segments }) => {
      const key = "trail-mapper.fixture:trail-mapper.web.library.v1";
      if (localStorage.getItem(key)) return;
      const at = (north: number) => ({
        latitude: 40.5 + north / 111_195,
        longitude: -88.95,
      });
      const total = segments.reduce(
        (sum, s) => sum + Math.abs(s.to - s.from),
        0,
      );
      const access = segments
        .filter((s) => s.type === "Access")
        .reduce((sum, s) => sum + Math.abs(s.to - s.from), 0);
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          saved: [
            {
              key: "seeded-" + title,
              title,
              createdAt: Date.now(),
              usedAt: Date.now(),
              route: {
                segments: segments.map((s) => ({
                  type: s.type,
                  points: [at(s.from), at(s.to)],
                  isRouted: s.routed ?? true,
                  routeRoles: s.roles ?? [],
                })),
                totalDistanceMeters: total,
                ordinaryAccessDistanceMeters: access,
                totalCost: 1,
                kind: "Navigation",
              },
              draft: {
                mode: "point",
                start: { label: "Private start", ...at(segments[0].from) },
                destination: {
                  label: "Private end",
                  ...at(segments.at(-1)!.to),
                },
                miles: 5,
                proposed: false,
              },
            },
          ],
          recent: [],
          places: [],
        }),
      );
    },
    { title, segments },
  );
}
async function exportSaved(page: Page, title: string) {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await page
    .getByRole("button", { name: new RegExp(title) })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await expect(dialog).toContainText("Many map apps ignore properties");
  await dialog
    .getByRole("checkbox", { name: /Include exact start and destination/ })
    .check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: /Download full route GeoJSON/ }).click(),
  ]);
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(path!, "utf8"));
}
test("an exported proposed route marks the proposed segment as not built", async ({
  page,
}) => {
  await seedSavedRoute(page, "Proposed test", [
    { type: "Trail", from: 0, to: 500 },
    { type: "Trail", from: 500, to: 1000, roles: ["ProposedTrails"] },
  ]);
  const file = await exportSaved(page, "Proposed test");
  const statuses = file.features.map((f: any) => f.properties.status);
  expect(statuses).toContain("proposed");
  const proposed = file.features.find(
    (f: any) => f.properties.status === "proposed",
  );
  expect(proposed.properties.verified).toBe(false);
  expect(file.routeContext.proposedTrailsIncluded).toBe(true);
  expect(file.routeContext.warnings.join(" ")).toMatch(/proposed/i);
  expect(JSON.stringify(file)).not.toMatch(
    /Private start|Private end|Proposed test/,
  );
});
test("an exported route with a gap exports the connection as ends only, without inventing a line", async ({
  page,
}) => {
  await seedSavedRoute(page, "Gap test", [
    { type: "Trail", from: 0, to: 500 },
    { type: "Access", from: 500, to: 530, routed: false },
    { type: "Trail", from: 530, to: 1000 },
  ]);
  const file = await exportSaved(page, "Gap test");
  const gap = file.features.find(
    (f: any) => f.properties.status === "unverified-connection",
  );
  expect(gap.geometry.type).toBe("MultiPoint");
  expect(gap.geometry.coordinates).toHaveLength(2);
  expect(file.routeContext.unverifiedConnections).toBeGreaterThanOrEqual(1);
  // No line runs across the 30 m gap.
  const lines = file.features.filter(
    (f: any) => f.geometry.type === "LineString",
  );
  for (const line of lines) {
    const norths = line.geometry.coordinates.map(
      (c: number[]) => (c[1] - 40.5) * 111_195,
    );
    expect(!(Math.min(...norths) < 505 && Math.max(...norths) > 525)).toBe(
      true,
    );
  }
});
test("an ordinary verified route exports existing trail with dataset context", async ({
  page,
}) => {
  await seedSavedRoute(page, "Ordinary test", [
    { type: "Trail", from: 0, to: 600 },
    { type: "Trail", from: 600, to: 1200 },
  ]);
  const file = await exportSaved(page, "Ordinary test");
  expect(
    file.features.every(
      (f: any) =>
        f.properties.status === "existing" && f.properties.verified === true,
    ),
  ).toBe(true);
  expect(file.routeContext.dataset.mode).toBe("fixture");
  expect(file.routeContext.unverifiedConnections).toBe(0);
  expect(file.routeContext.note).toMatch(/ignore properties/);
});

test("an export made days after the route was opened identifies its status as cached from the evaluation time", async ({
  page,
}) => {
  const opened = new Date("2026-09-20T12:00:00Z");
  await page.clock.install({ time: opened });
  await seedSavedRoute(page, "Cached test", [
    { type: "Trail", from: 0, to: 600 },
    { type: "Trail", from: 600, to: 1200 },
  ]);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Cached test/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await expect(dialog).toContainText("last checked");
  // Two days pass with the route still open.
  await page.clock.fastForward(2 * 24 * 3600 * 1000);
  await dialog
    .getByRole("checkbox", { name: /Include exact start and destination/ })
    .check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: /Download full route GeoJSON/ }).click(),
  ]);
  const { readFile } = await import("node:fs/promises");
  const file = JSON.parse(await readFile((await download.path())!, "utf8"));
  const context = file.routeContext;
  expect(context.statusIsCached).toBe(true);
  expect(new Date(context.statusCheckedAt).getTime()).toBeLessThan(
    opened.getTime() + 60_000,
  );
  expect(new Date(context.exportedAt).getTime()).toBeGreaterThan(
    opened.getTime() + 2 * 24 * 3600 * 1000 - 60_000,
  );
  expect(context.statusAgeSeconds).toBeGreaterThan(2 * 24 * 3600 - 120);
  expect(context.statusCheckedAt).not.toBe(context.exportedAt);
});
