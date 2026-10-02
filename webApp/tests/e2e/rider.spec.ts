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
  // As in native, a loop says whether the target was met and what was asked against what was found.
  await expect(
    page.getByText("Exercise loop ready", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Requested 5 mi · Found [\d.]+ mi$/),
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

test("a structurally invalid stored route is set aside without blanking the app", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await plan(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved · View" }),
  ).toBeVisible();
  // Add one recent record whose draft is null next to the valid saved route.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith("trail-mapper.web.library.v1"),
    )!;
    const library = JSON.parse(localStorage.getItem(key)!);
    library.recent = [{ ...library.saved[0], key: "bad", draft: null }];
    localStorage.setItem(key, JSON.stringify(library));
  });
  await page.goto("/");
  const notice = page.getByText("could not be read and were set aside");
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete unreadable data" }).click();
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Route controls" }),
  ).toBeFocused();
  expect(failures).toEqual([]);
});

test("a crashed routing worker is reported at once and an explicit restart recovers without losing the draft", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.Worker;
    const created: Worker[] = [];
    (window as any).__workers = created;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        created.push(this);
      }
    } as typeof Worker;
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.evaluate(() => {
    const workers = (window as any).__workers as Worker[];
    workers.at(-1)!.dispatchEvent(new ErrorEvent("error"));
  });
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  const alert = page.getByRole("alert").filter({
    hasText: "Route planning stopped unexpectedly",
  });
  await expect(alert).toBeVisible({ timeout: 2000 });
  await expect(alert).not.toContainText(/Kotlin|rebuild/i);
  await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
    "Review trailhead · East",
  );
  await alert.getByRole("button", { name: "Restart route planning" }).click();
  await expect(alert).toHaveCount(0);
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
});

async function trackWorkers(page: Page) {
  await page.addInitScript(() => {
    const Original = window.Worker;
    const created: Worker[] = [];
    (window as any).__workers = created;
    (window as any).__dropInspect = false;
    (window as any).__holdBoot = false;
    (window as any).__heldBoots = [];
    // Survives a reload so a test can hold the restore inspection of the page it reloads into.
    (window as any).__holdInspect =
      sessionStorage.getItem("hold-inspect") === "1";
    (window as any).__heldInspects = [];
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        created.push(this);
      }
      postMessage(message: any, ...rest: any[]) {
        if (message?.request?.op === "boot" && (window as any).__holdBoot) {
          (window as any).__heldBoots.push(() =>
            (super.postMessage as any)(message, ...rest),
          );
          return;
        }
        if (message?.request?.op === "inspect" && (window as any).__dropInspect)
          return;
        if (
          message?.request?.op === "inspect" &&
          (window as any).__holdInspect
        ) {
          (window as any).__heldInspects.push(() =>
            (super.postMessage as any)(message, ...rest),
          );
          return;
        }
        (super.postMessage as any)(message, ...rest);
      }
    } as typeof Worker;
  });
}
const crashWorker = (page: Page) =>
  page.evaluate(() =>
    ((window as any).__workers as Worker[])
      .at(-1)!
      .dispatchEvent(new ErrorEvent("error")),
  );
test("a worker crash between location updates clears turn guidance at once and restart resumes only after a fresh fix", async ({
  page,
}) => {
  await trackWorkers(page);
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
  await crashWorker(page);
  await expect(page.locator(".guidance.navigating")).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "Route planning stopped" }),
  ).toBeVisible();
  await expect(
    page.getByText("Restart route planning to continue"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restart route planning" }).click();
  await expect(page.getByText("Route planning restarted")).toBeVisible();
  // Still no guidance until a new location is evaluated successfully.
  await expect(page.locator(".guidance.navigating")).toHaveCount(0);
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.51, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
});
test("a worker crash while opening a saved route can be restarted and the same route previews", async ({
  page,
}) => {
  await trackWorkers(page);
  await plan(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved · View" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Saved · View" }).click();
  await page.evaluate(() => ((window as any).__dropInspect = true));
  await page
    .getByRole("button", {
      name: /Review trailhead · East to Review trailhead · South/,
    })
    .first()
    .click();
  await crashWorker(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Route planning stopped" }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).__dropInspect = false));
  await page.getByRole("button", { name: "Restart route planning" }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("No route is available")).toHaveCount(0);
});

test("opening another saved route while a restart boots is not overwritten by the abandoned restart", async ({
  page,
}) => {
  await trackWorkers(page);
  await plan(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  // A second, different saved route: an exercise loop.
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: "3 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Saved · View" }).click();
  await page.evaluate(() => ((window as any).__dropInspect = true));
  await page
    .getByRole("button", {
      name: /Review trailhead · East to Review trailhead · South/,
    })
    .first()
    .click();
  await crashWorker(page);
  await page.evaluate(() => {
    (window as any).__dropInspect = false;
    (window as any).__holdBoot = true;
  });
  await page.getByRole("button", { name: "Restart route planning" }).click();
  // Back to Saved and open the loop while the replacement worker is still booting.
  await page.getByRole("button", { name: "← Back" }).click();
  await page
    .getByRole("button", { name: /mi loop from/ })
    .first()
    .click();
  await page.evaluate(() => {
    (window as any).__holdBoot = false;
    ((window as any).__heldBoots as Array<() => void>)
      .splice(0)
      .forEach((f) => f());
  });
  await page.waitForTimeout(500);
  // The abandoned restart must not attach the first route's 1.4 mi preview to the loop.
  await expect(page.getByText("1.4", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /mi loop from Review trailhead/ }),
  ).toBeVisible();
});

test("a reroute that resolves after location was lost is not adopted", async ({
  page,
}) => {
  // Hold the worker's reroute answer so the rider's state can change first.
  await page.addInitScript(() => {
    const Original = window.Worker;
    const held: Array<() => void> = [];
    let released = false;
    (window as any).__releaseReroute = () => {
      released = true;
      held.splice(0).forEach((f) => f());
    };
    window.Worker = class extends Original {
      private rerouteIds = new Set<number>();
      postMessage(message: any, ...rest: any[]) {
        if (message?.request?.op === "reroute") this.rerouteIds.add(message.id);
        (super.postMessage as any)(message, ...rest);
      }
      set onmessage(handler: ((e: MessageEvent) => void) | null) {
        super.onmessage = handler
          ? (event: MessageEvent) => {
              if (!released && this.rerouteIds.has(event.data?.id))
                held.push(() => handler(event));
              else handler(event);
            }
          : null;
      }
      get onmessage() {
        return super.onmessage;
      }
    } as typeof Worker;
  });
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
  await page.clock.fastForward(8000);
  await acceptedFix(page, 40.5085, -88.96);
  await page.clock.fastForward(8000);
  await acceptedFix(page, 40.508, -88.96);
  await expect(
    page.getByRole("heading", { name: "You are off route", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reroute", exact: true }).click();
  // Location is lost before the worker's answer is delivered.
  await page.evaluate(() => (window as any).__gps.failure());
  await page.evaluate(() => (window as any).__releaseReroute());
  await expect(
    page.getByText("your current route was kept", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Returning to start" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reroute" })).toHaveCount(0);
});

test("rejoining the loop keeps the ride's observed distance, and it survives a reload", async ({
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
  await acceptedFix(page, 40.51, -88.95);
  const path = ((await ride()).record.route.segments as any[]).flatMap((s) =>
    (s.points as { latitude: number; longitude: number }[]).map((p) => [
      p.latitude,
      p.longitude,
    ]),
  );
  // Ride along the route so real, observed distance accumulates.
  const stepEvery = Math.max(1, Math.floor(path.length / 60));
  for (
    let index = stepEvery;
    index <= Math.floor(path.length * 0.15);
    index += stepEvery
  ) {
    await page.clock.fastForward(1000);
    await acceptedFix(page, path[index][0], path[index][1]);
  }
  const before = (await ride()).creditedDistanceMeters as number;
  expect(before).toBeGreaterThan(100);
  // Leave the route far enough to confirm off route, then rejoin.
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.491, -88.99);
  await page.clock.fastForward(8000);
  await acceptedFix(page, 40.492, -88.99);
  await page.clock.fastForward(8000);
  await acceptedFix(page, 40.493, -88.99);
  await page
    .getByRole("button", { name: "Rejoin the loop", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  const after = await ride();
  expect(after.routeProgressMeters).toBe(0);
  expect(after.creditedDistanceMeters).toBeCloseTo(before, 3);
  // The total is restored with the ride after a reload.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  expect((await ride()).creditedDistanceMeters).toBeCloseTo(before, 3);
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

type MeterPoint = [east: number, north: number];
const OUT_AND_BACK: MeterPoint[] = [
  [0, 0],
  [0, 1000],
  [0, 2000],
  [0, 1000],
  [0, 0],
];
/** Restore a saved ride on a synthetic loop given in metres east/north of a fixed origin. */
async function seedLoopRide(
  page: Page,
  path: MeterPoint[],
  progress: number,
  total = 4000,
) {
  await page.clock.install();
  await page.addInitScript(
    ({ path, progress, total }) => {
      const key = "trail-mapper.fixture:trail-mapper.web.active-ride.v1";
      if (localStorage.getItem(key)) return;
      const at = ([east, north]: [number, number]) => ({
        latitude: 40.5 + north / 111_195,
        longitude: -88.95 + east / (111_195 * Math.cos((40.5 * Math.PI) / 180)),
      });
      const points = path.map(at);
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          record: {
            key: "seeded-loop",
            title: "Seeded loop",
            createdAt: Date.now(),
            usedAt: Date.now(),
            route: {
              segments: points.slice(1).map((end, index) => ({
                type: "Trail",
                points: [points[index], end],
                isRouted: true,
              })),
              totalDistanceMeters: total,
              ordinaryAccessDistanceMeters: 0,
              totalCost: 1,
              kind: "ExerciseLoop",
            },
            draft: {
              mode: "loop",
              start: { label: "Trailhead", ...points[0] },
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
    },
    { path, progress, total },
  );
}
const seedOutAndBackRide = (page: Page, progress: number) =>
  seedLoopRide(page, OUT_AND_BACK, progress);
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

test("a repeated junction never rewinds the saved progress into the completed section", async ({
  page,
}) => {
  await seedLoopRide(
    page,
    [
      [0, -1000],
      [0, 0],
      [100, 0],
      [100, 250],
      [4, 250],
      [4, 0],
      [4, 600],
      [-100, 600],
      [-100, 0],
      [0, 0],
      [0, -1000],
    ],
    1700,
    4100,
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  // The old junction at (0, 0), where the supported later pass is 4 m away.
  await acceptedFix(page, 40.5, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith("trail-mapper.web.active-ride.v1"),
    );
    return JSON.parse(localStorage.getItem(key!)!);
  });
  expect(stored.routeProgressMeters).toBeGreaterThan(1600);
  expect(stored.routeProgressMeters).toBeLessThan(1800);
  expect(stored.creditedDistanceMeters).toBe(2000);
  const readRide = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.endsWith("trail-mapper.web.active-ride.v1"),
      );
      return JSON.parse(localStorage.getItem(key!)!);
    });
  // A second identical fix a second later must not undo the recovery.
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.5, -88.95);
  const same = await readRide();
  expect(same.routeProgressMeters).toBeGreaterThan(1600);
  expect(same.routeProgressMeters).toBeLessThan(1800);
  expect(same.creditedDistanceMeters).toBe(2000);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  // Then forward movement 100 m up the supported pass continues from there.
  await page.clock.fastForward(1000);
  await acceptedFix(
    page,
    40.5 + 100 / 111_195,
    -88.95 + 4 / (111_195 * Math.cos((40.5 * Math.PI) / 180)),
  );
  const ahead = await readRide();
  expect(ahead.routeProgressMeters).toBeGreaterThan(1750);
  expect(ahead.routeProgressMeters).toBeLessThan(1850);
  expect(ahead.creditedDistanceMeters).toBeGreaterThan(2000);
  expect(ahead.creditedDistanceMeters).toBeLessThan(2150);
});

test("61 m of ordinary backtracking on the outbound pass never jumps to the return pass or credits distance", async ({
  page,
}) => {
  await seedOutAndBackRide(page, 1000);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.5 + 1000 / 111_195, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await page.clock.fastForward(10_000);
  await acceptedFix(page, 40.5 + 939 / 111_195, -88.95);
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith("trail-mapper.web.active-ride.v1"),
    );
    return JSON.parse(localStorage.getItem(key!)!);
  });
  expect(stored.routeProgressMeters).toBeGreaterThan(900);
  expect(stored.routeProgressMeters).toBeLessThan(1100);
  expect(stored.creditedDistanceMeters).toBe(2000);
});

test("a stationary rider on a short repeated junction never switches to the completed pass", async ({
  page,
}) => {
  await seedLoopRide(
    page,
    [
      [0, -1000],
      [0, 0],
      [25, 0],
      [25, 75],
      [4, 75],
      [4, 0],
      [4, 600],
      [-100, 600],
      [-100, 0],
      [0, 0],
      [0, -1000],
    ],
    1200,
    3600,
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  const readRide = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.endsWith("trail-mapper.web.active-ride.v1"),
      );
      return JSON.parse(localStorage.getItem(key!)!);
    });
  // The old junction at (0, 0), then identical fixes one second apart.
  for (let count = 0; count < 3; count++) {
    await page.clock.fastForward(1000);
    await acceptedFix(page, 40.5, -88.95);
    const ride = await readRide();
    expect(ride.routeProgressMeters).toBeGreaterThan(1150);
    expect(ride.routeProgressMeters).toBeLessThan(1250);
    expect(ride.creditedDistanceMeters).toBe(2000);
  }
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  // Forward movement 30 m up the supported pass continues from there.
  await page.clock.fastForward(1000);
  await acceptedFix(
    page,
    40.5 + 30 / 111_195,
    -88.95 + 4 / (111_195 * Math.cos((40.5 * Math.PI) / 180)),
  );
  const ahead = await readRide();
  expect(ahead.routeProgressMeters).toBeGreaterThan(1210);
  expect(ahead.routeProgressMeters).toBeLessThan(1250);
  expect(ahead.creditedDistanceMeters).toBeLessThan(2060);
});

test("riding east around an ordinary corner advances progress, guidance and observed credit with each fix", async ({
  page,
}) => {
  await seedLoopRide(
    page,
    [
      [0, 0],
      [0, 1000],
      [1000, 1000],
      [1000, 0],
      [0, 0],
    ],
    1000,
    4000,
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  const readRide = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.endsWith("trail-mapper.web.active-ride.v1"),
      );
      return JSON.parse(localStorage.getItem(key!)!);
    });
  const east = (meters: number) =>
    -88.95 + meters / (111_195 * Math.cos((40.5 * Math.PI) / 180));
  // The first corner (resume), then fixes 20, 40 and 60 m along the east leg, five seconds apart.
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.5 + 1000 / 111_195, east(0));
  let previous = await readRide();
  for (const meters of [20, 40, 60]) {
    await page.clock.fastForward(5000);
    await acceptedFix(page, 40.5 + 1000 / 111_195, east(meters));
    const ride = await readRide();
    expect(ride.routeProgressMeters).toBeGreaterThan(1000 + meters - 8);
    expect(ride.routeProgressMeters).toBeLessThan(1000 + meters + 8);
    // Observed movement of about 20 m is credited each time.
    const gained =
      ride.creditedDistanceMeters - previous.creditedDistanceMeters;
    expect(gained).toBeGreaterThan(12);
    expect(gained).toBeLessThan(28);
    await expect(page.locator(".guidance.navigating")).toBeVisible();
    previous = ride;
  }
  await expect(page.getByText("We can't tell where you are")).toHaveCount(0);
});

for (const cancel of ["upper", "lower"] as const) {
  test(`${cancel} Cancel map selection returns to the planner with the point draft intact`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Go somewhere/ }).click();
    await choose(page, "Start", "Review trailhead · East");
    await choose(page, "Destination", "Review trailhead · South");
    const proposed = page.getByRole("checkbox", {
      name: /Include proposed trails/,
    });
    await proposed.check();
    for (const field of ["Start", "Destination"] as const) {
      await page
        .getByRole("button", { name: new RegExp("^" + field + ":") })
        .click();
      await page
        .getByRole("button", { name: "Pick on map", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Use map center" }),
      ).toBeVisible();
      // Move the map so an unconfirmed pick would differ if it were applied.
      await page
        .getByRole("region", { name: /Interactive map/ })
        .press("ArrowLeft");
      if (cancel === "upper") await page.locator("button.back").click();
      else
        await page
          .getByRole("button", { name: "Cancel map selection", exact: true })
          .click();
      await expect(
        page.getByRole("button", { name: "Find route", exact: true }),
      ).toBeVisible();
      // Focus lands on the planner heading rather than being lost with the picker.
      await expect(page.locator("#route-controls h1")).toBeFocused();
      await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
        "Review trailhead · East",
      );
      await expect(
        page.getByRole("button", { name: /^Destination:/ }),
      ).toContainText("Review trailhead · South");
      await expect(proposed).toBeChecked();
    }
    // The draft also survives a reload.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
      "Review trailhead · East",
    );
    await expect(
      page.getByRole("button", { name: /^Destination:/ }),
    ).toContainText("Review trailhead · South");
  });
  test(`${cancel} Cancel map selection returns to the loop planner with distance intact`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Make an exercise loop/ }).click();
    await choose(page, "Start", "Review trailhead · East");
    await page.getByRole("button", { name: "5 mi", exact: true }).click();
    await page.getByRole("button", { name: /^Start:/ }).click();
    await page
      .getByRole("button", { name: "Pick on map", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Use map center" }),
    ).toBeVisible();
    if (cancel === "upper") await page.locator("button.back").click();
    else
      await page
        .getByRole("button", { name: "Cancel map selection", exact: true })
        .click();
    await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
      "Review trailhead · East",
    );
    await expect(
      page.getByRole("button", { name: "5 mi", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Make loop", exact: true }),
    ).toBeEnabled();
  });
}

const savedNav = (page: Page) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true });
test("browser Back and Forward move between main screens instead of leaving the app", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await savedNav(page).click();
  await expect(
    page.getByRole("heading", { name: "Saved", exact: true, level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Saved", exact: true, level: 1 }),
  ).toBeVisible();
  expect(page.url()).toMatch(/\/$/);
});
test("browser Back from the map picker and from a preview returns to the intact planner draft", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page.getByRole("button", { name: "Pick on map", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use map center" }),
  ).toBeVisible();
  await page.goBack();
  // The chooser dialog was open under the picker: Back returns to the planner, not Home.
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
    "Review trailhead · East",
  );
  await expect(
    page.getByRole("button", { name: /^Destination:/ }),
  ).toContainText("Review trailhead · South");
  await page.goForward();
  // Stepping forward never re-opens the picker or a dialog.
  await expect(
    page.getByRole("button", { name: "Use map center" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
    "Review trailhead · East",
  );
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
});
test("browser Back closes an open dialog before it leaves the screen", async ({
  page,
}) => {
  await plan(page);
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Directions" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Directions" })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  // Closing with the app's own button also leaves history tidy: one Back reaches the planner.
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await page.getByRole("button", { name: "Close Directions" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeVisible();
});
test("browser Back during an active ride keeps navigating and Forward never restarts it", async ({
  page,
}) => {
  await plan(page);
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await acceptedFix(page, 40.51, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Your ride is still active")).toBeVisible();
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop navigation" }).first(),
  ).toBeVisible();
  await page.goForward();
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  // Only the explicit Stop button ends the ride; then Back/Forward never brings it back.
  await page.getByRole("button", { name: "Stop navigation" }).last().click();
  await expect(page.locator(".guidance.navigating")).toHaveCount(0);
  await page.goBack();
  await page.goForward();
  await expect(page.locator(".guidance")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__gps.watches())).toBe(0);
});
test("history entries and the URL never contain places, labels or route geometry, and Back still works after a reload", async ({
  page,
}) => {
  await plan(page);
  const before = page.url();
  const states = await page.evaluate(() => JSON.stringify(history.state));
  expect(states).not.toMatch(/Review trailhead|latitude|longitude|-88\.|40\./);
  expect(Object.keys(JSON.parse(states)).sort().join()).toMatch(
    /^(overlay,screen,tm|screen,tm)$/,
  );
  expect(page.url()).toBe(before);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.goBack();
  // After a reload the earlier entries fall back to a safe screen rather than leaving the app or showing nothing.
  await expect(
    page.getByRole("button", { name: /Go somewhere|Find route/ }).first(),
  ).toBeVisible();
  expect(page.url()).toBe(before);
});

test("history stays sound when a chooser is open before history starts, after a no-op fallback and around the skip link", async ({
  page,
}) => {
  await trackWorkers(page);
  await plan(page);
  await page.waitForTimeout(600);
  // Reload with the restored preview's inspection held, so the app is usable before history starts.
  await page.evaluate(() => sessionStorage.setItem("hold-inspect", "1"));
  await page.reload();
  await expect(
    page.getByText("Checking the known closure catalog"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.removeItem("hold-inspect");
    (window as any).__holdInspect = false;
    ((window as any).__heldInspects as Array<() => void>)
      .splice(0)
      .forEach((f) => f());
  });
  await page.waitForTimeout(300);
  await page
    .getByRole("button", { name: /^Close/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Closing the chooser must not have popped an entry that was never pushed (that left the app).
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => history.state !== null)).toBe(true);
  // Preview -> Home -> planner -> Home, then Back three times and a new destination.
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await expect(
    page.getByRole("heading", { name: "Plan a ride", exact: true }),
  ).toBeVisible();
  // Step back through the entries (the restored one was relabelled with what was really on screen) to Home.
  const home = page.getByRole("heading", { name: "Plan a ride", exact: true });
  await page.goBack();
  for (let steps = 0; steps < 4 && !(await home.isVisible()); steps++) {
    await page.goBack();
    await page.waitForTimeout(150);
  }
  await expect(home).toBeVisible();
  expect(page.url()).toMatch(/127\.0\.0\.1/);
  await savedNav(page).click();
  await expect(
    page.getByRole("heading", { name: "Saved", exact: true, level: 1 }),
  ).toBeVisible();
  // A new navigation replaces any obsolete forward history: Forward has nowhere to go.
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Saved", exact: true, level: 1 }),
  ).toBeVisible();
});
test("the skip link moves focus without adding an unmanaged history entry", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("link", { name: "Skip to route controls" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#route-controls")).toBeFocused();
  expect(page.url()).not.toContain("#");
  await savedNav(page).click();
  await expect(
    page.getByRole("heading", { name: "Saved", exact: true, level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
});

test("closing a chooser that was already open when history started never leaves the app", async ({
  page,
  context,
}) => {
  // Persist a preview in this browser context, then open the app in a fresh tab with no earlier history.
  await plan(page);
  await page.waitForTimeout(600);
  const fresh = await context.newPage();
  await fresh.addInitScript(() => sessionStorage.setItem("hold-inspect", "1"));
  await trackWorkers(fresh);
  await fresh.goto("/");
  await expect(
    fresh.getByText("Checking the known closure catalog"),
  ).toBeVisible();
  await fresh.getByRole("button", { name: "Trail Mapper home" }).click();
  await fresh.getByRole("button", { name: /Go somewhere/ }).click();
  await fresh.getByRole("button", { name: /^Start:/ }).click();
  await expect(fresh.getByRole("dialog")).toBeVisible();
  // Restore finishes now, so history starts with the chooser already open.
  await fresh.evaluate(() => {
    sessionStorage.removeItem("hold-inspect");
    (window as any).__holdInspect = false;
    ((window as any).__heldInspects as Array<() => void>)
      .splice(0)
      .forEach((f) => f());
  });
  await fresh.waitForTimeout(400);
  await fresh
    .getByRole("button", { name: /^Close/ })
    .first()
    .click();
  await expect(fresh.getByRole("dialog")).toHaveCount(0);
  await fresh.waitForTimeout(400);
  // Still in the app, not the document before it.
  expect(fresh.url()).toMatch(/127\.0\.0\.1/);
  await expect(
    fresh.getByRole("button", { name: "Find route", exact: true }),
  ).toBeVisible();
});

test("screen visits made before restoration finishes are recorded, so Back returns through them", async ({
  page,
  context,
}) => {
  await plan(page);
  await page.waitForTimeout(600);
  const fresh = await context.newPage();
  await fresh.addInitScript(() => sessionStorage.setItem("hold-inspect", "1"));
  await trackWorkers(fresh);
  await fresh.goto("/");
  await expect(
    fresh.getByText("Checking the known closure catalog"),
  ).toBeVisible();
  await fresh.getByRole("button", { name: "Trail Mapper home" }).click();
  await fresh.getByRole("button", { name: /Go somewhere/ }).click();
  await fresh.getByRole("button", { name: /^Start:/ }).click();
  await fresh.getByRole("button", { name: "Pick on map", exact: true }).click();
  await expect(
    fresh.getByRole("button", { name: "Use map center" }),
  ).toBeVisible();
  await fresh.evaluate(() => {
    sessionStorage.removeItem("hold-inspect");
    (window as any).__holdInspect = false;
    ((window as any).__heldInspects as Array<() => void>)
      .splice(0)
      .forEach((f) => f());
  });
  await fresh.waitForTimeout(400);
  await fresh.goBack();
  // Back from the picker returns to the planner rather than the document before the app.
  expect(fresh.url()).toMatch(/127\.0\.0\.1/);
  await expect(
    fresh.getByRole("button", { name: "Find route", exact: true }),
  ).toBeVisible();
  await fresh.goBack();
  expect(fresh.url()).toMatch(/127\.0\.0\.1/);
  await expect(
    fresh.getByRole("heading", { name: "Plan a ride", exact: true }),
  ).toBeVisible();
});

test("share failures, cancelled sharing and download results appear inside the open dialog", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__shareMode = "reject";
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => {
        const mode = (window as any).__shareMode;
        if (mode === "abort") throw new DOMException("cancelled", "AbortError");
        if (mode === "reject") throw new Error("share refused");
      },
    });
  });
  await plan(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  const shareButton = dialog.getByRole("button", { name: "Share summary" });
  // A real failure is announced in the dialog, with the summary still there to copy.
  await shareButton.click();
  const error = dialog
    .getByRole("alert")
    .filter({ hasText: "Sharing is unavailable" });
  await expect(error).toBeVisible();
  await expect(dialog.locator(".share-preview")).toContainText("Trail");
  // The page behind the dialog is inert and must not be where the message lives.
  await expect(page.locator("#route-controls > .error")).toHaveCount(0);
  // Cancelling the system sheet is not a failure: no error, dialog stays open.
  await page.evaluate(() => ((window as any).__shareMode = "abort"));
  await shareButton.click();
  await expect(error).toHaveCount(0);
  await expect(dialog).toBeVisible();
  // Retry succeeds and closes the dialog.
  await page.evaluate(() => ((window as any).__shareMode = "ok"));
  await shareButton.click();
  await expect(dialog).toHaveCount(0);
});
test("download success and failure are reported in the dialog and the endpoint choice is kept", async ({
  page,
}) => {
  await plan(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await dialog
    .getByRole("checkbox", { name: /Include exact start and destination/ })
    .check();
  await page.evaluate(() => {
    (window as any).__createObjectURL = URL.createObjectURL;
    URL.createObjectURL = () => {
      throw new Error("Downloads are unavailable in this browser.");
    };
  });
  await dialog
    .getByRole("button", { name: /Download full route GeoJSON/ })
    .click();
  await expect(
    dialog.getByRole("alert").filter({ hasText: "Downloads are unavailable" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: /Include exact start/ }),
  ).toBeChecked();
  await page.evaluate(() => {
    URL.createObjectURL = (window as any).__createObjectURL;
  });
  await dialog
    .getByRole("button", { name: /Download full route GeoJSON/ })
    .click();
  await expect(
    dialog.getByRole("status").filter({ hasText: "Full route downloaded" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("alert").filter({ hasText: "unavailable" }),
  ).toHaveCount(0);
  // Feedback is per dialog session: reopening starts clean.
  await page.getByRole("button", { name: "Close Share route" }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Share route" })
      .getByRole("status")
      .filter({ hasText: "downloaded" }),
  ).toHaveCount(0);
});
test("rename and clear failures from full or unavailable storage stay in their dialog and keep the input", async ({
  page,
}) => {
  await plan(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Saved · View" }).click();
  await page
    .getByRole("button", { name: /^Rename Review trailhead · East/ })
    .click();
  const rename = page.getByRole("dialog", { name: "Rename" });
  await rename
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("My new name");
  await page.evaluate(() => {
    (window as any).__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await rename.getByRole("button", { name: "Save name" }).click();
  await expect(
    rename.getByRole("alert").filter({ hasText: "Browser storage is full" }),
  ).toBeVisible();
  await expect(
    rename.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("My new name");
  // Retry after space is available.
  await page.evaluate(() => {
    Storage.prototype.setItem = (window as any).__setItem;
  });
  await rename.getByRole("button", { name: "Save name" }).click();
  await expect(rename).toHaveCount(0);
});
test("clearing recents with unavailable storage reports it in the dialog and can be cancelled", async ({
  page,
}) => {
  await plan(page);
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await page.getByRole("tab", { name: /^Recent/ }).click();
  await page.getByRole("button", { name: "Clear recents" }).click();
  const dialog = page.getByRole("dialog");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
  });
  await dialog.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(
    dialog
      .getByRole("alert")
      .filter({ hasText: "Browser storage is unavailable" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("a late share result cannot touch a later dialog session, and empty live regions stay exposed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let pending: { resolve: () => void; reject: (e: Error) => void } | null =
      null;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () =>
        new Promise<void>((resolve, reject) => {
          pending = { resolve, reject };
        }),
    });
    (window as any).__finishShare = (ok: boolean) =>
      ok ? pending?.resolve() : pending?.reject(new Error("late failure"));
  });
  await plan(page);
  const openShare = async () => {
    await page.getByRole("button", { name: "Share", exact: true }).click();
    return page.getByRole("dialog", { name: "Share route" });
  };
  let dialog = await openShare();
  // Both announcers exist in the accessibility tree before anything is said.
  for (const role of ["alert", "status"] as const) {
    const region = dialog.locator(`[role="${role}"]`).first();
    await expect(region).toBeAttached();
    expect(
      await region.evaluate((el) => getComputedStyle(el).display),
    ).not.toBe("none");
  }
  // Start a share, close the dialog, open a new one, then let the old attempt fail.
  await dialog.getByRole("button", { name: "Share summary" }).click();
  await page.getByRole("button", { name: "Close Share route" }).click();
  dialog = await openShare();
  await page.evaluate(() => (window as any).__finishShare(false));
  await page.waitForTimeout(300);
  await expect(
    dialog.getByRole("alert").filter({ hasText: "Sharing is unavailable" }),
  ).toHaveCount(0);
  // The same for a late success: it must not close the new dialog.
  await dialog.getByRole("button", { name: "Share summary" }).click();
  await page.getByRole("button", { name: "Close Share route" }).click();
  dialog = await openShare();
  await page.evaluate(() => (window as any).__finishShare(true));
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  // Overlapping attempts in one session: only the latest counts.
  await dialog.getByRole("button", { name: "Share summary" }).click();
  await dialog.getByRole("button", { name: "Share summary" }).click();
  await page.evaluate(() => (window as any).__finishShare(false));
  await expect(
    dialog.getByRole("alert").filter({ hasText: "Sharing is unavailable" }),
  ).toBeVisible();
});
test("repeating the same success or failure is a real change in the live region", async ({
  page,
}) => {
  await plan(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await page.evaluate(() => {
    const region = document.querySelector('dialog [role="status"]')!;
    (window as any).__seen = [] as string[];
    new MutationObserver(() =>
      (window as any).__seen.push(region.textContent ?? ""),
    ).observe(region, { childList: true, characterData: true, subtree: true });
  });
  const download = dialog.getByRole("button", {
    name: /Download private GeoJSON/,
  });
  await download.click();
  await expect(
    dialog.getByRole("status").filter({ hasText: "Route downloaded" }),
  ).toBeVisible();
  await download.click();
  await expect
    .poll(async () => {
      const seen: string[] = await page.evaluate(() => (window as any).__seen);
      const first = seen.findIndex((text) => text.includes("Route downloaded"));
      const gap = seen.slice(first + 1).findIndex((text) => text === "");
      return (
        first >= 0 &&
        gap >= 0 &&
        seen
          .slice(first + 1 + gap)
          .some((text) => text.includes("Route downloaded"))
      );
    })
    .toBe(true);
});
test("a rejected clipboard copy reports in the dialog and can be retried", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    (window as any).__clipboardOk = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          if (!(window as any).__clipboardOk)
            throw new Error("clipboard blocked");
        },
      },
    });
  });
  await plan(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await dialog.getByRole("button", { name: "Copy summary" }).click();
  await expect(
    dialog.getByRole("alert").filter({ hasText: "Sharing is unavailable" }),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).__clipboardOk = true));
  await dialog.getByRole("button", { name: "Copy summary" }).click();
  await expect(dialog).toHaveCount(0);
});
test("exporting a route too short to hide its endpoints explains why and keeps the privacy choice", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const key = "trail-mapper.fixture:trail-mapper.web.library.v1";
    if (localStorage.getItem(key)) return;
    const at = (north: number) => ({
      latitude: 40.5 + north / 111_195,
      longitude: -88.95,
    });
    const points = [at(0), at(55), at(111)];
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        saved: [
          {
            key: "short-route",
            title: "Tiny test route",
            createdAt: Date.now(),
            usedAt: Date.now(),
            route: {
              segments: [{ type: "Trail", points, isRouted: true }],
              totalDistanceMeters: 111,
              ordinaryAccessDistanceMeters: 0,
              totalCost: 1,
              kind: "Navigation",
            },
            draft: {
              mode: "point",
              start: { label: "Start", ...points[0] },
              destination: { label: "End", ...points[2] },
              miles: 5,
              proposed: false,
            },
          },
        ],
        recent: [],
        places: [],
      }),
    );
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Tiny test route/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await dialog
    .getByRole("button", { name: /Download private GeoJSON/ })
    .click();
  await expect(
    dialog.getByRole("alert").filter({ hasText: /too short/i }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", {
      name: /Include exact start and destination/,
    }),
  ).not.toBeChecked();
  await expect(dialog).toBeVisible();
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

// Interactions between the separately reviewed fixes.
test("an unreadable-data notice and a dialog storage failure coexist and both survive cancelling", async ({
  page,
}) => {
  await seedSavedRoute(page, "Interplay test", [
    { type: "Trail", from: 0, to: 600 },
    { type: "Trail", from: 600, to: 1200 },
  ]);
  await page.addInitScript(() => {
    const key = "trail-mapper.fixture:trail-mapper.web.library.v1";
    const library = JSON.parse(localStorage.getItem(key)!);
    if (library.recent.length) return;
    library.recent = [{ ...library.saved[0], key: "broken", draft: null }];
    localStorage.setItem(key, JSON.stringify(library));
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  const notice = page.getByText("could not be read and were set aside");
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: /^Rename Interplay test/ }).click();
  const rename = page.getByRole("dialog", { name: "Rename" });
  await rename
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Renamed");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await rename.getByRole("button", { name: "Save name" }).click();
  await expect(
    rename.getByRole("alert").filter({ hasText: "Browser storage is full" }),
  ).toBeVisible();
  await rename.getByRole("button", { name: "Cancel" }).click();
  await expect(rename).toHaveCount(0);
  // The unreadable-data notice is still offered behind the closed dialog.
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete unreadable data" }),
  ).toBeVisible();
});
test("a restored planner draft survives the map picker, browser Back and both Cancel buttons", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.waitForTimeout(600);
  await page.reload();
  const start = page.getByRole("button", { name: /^Start:/ });
  await expect(start).toContainText("Review trailhead · East");
  const openPicker = async () => {
    await page.getByRole("button", { name: /^Start:/ }).click();
    await page
      .getByRole("button", { name: "Pick on map", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Use map center" }),
    ).toBeVisible();
  };
  await openPicker();
  await page.goBack();
  await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
    "Review trailhead · East",
  );
  await openPicker();
  await page.locator("button.back").click();
  await expect(
    page.getByRole("button", { name: /^Destination:/ }),
  ).toContainText("Review trailhead · South");
  await openPicker();
  await page
    .getByRole("button", { name: "Cancel map selection", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^Start:/ })).toContainText(
    "Review trailhead · East",
  );
  await expect(
    page.getByRole("button", { name: /^Destination:/ }),
  ).toContainText("Review trailhead · South");
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeEnabled();
});
test("reopening a route refreshes the status time an export reports", async ({
  page,
}) => {
  const opened = new Date("2026-09-20T12:00:00Z");
  await page.clock.install({ time: opened });
  await seedSavedRoute(page, "Refresh test", [
    { type: "Trail", from: 0, to: 600 },
    { type: "Trail", from: 600, to: 1200 },
  ]);
  const open = async () => {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Saved", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Refresh test/ })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: "Route preview", exact: true }),
    ).toBeVisible();
  };
  await page.goto("/");
  await open();
  await page.clock.fastForward(24 * 3600 * 1000);
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await open();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await dialog
    .getByRole("checkbox", { name: /Include exact start and destination/ })
    .check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: /Download full route GeoJSON/ }).click(),
  ]);
  const { readFile } = await import("node:fs/promises");
  const file = JSON.parse(await readFile((await download.path())!, "utf8"));
  // The second opening re-evaluated the route a day later, so the reported check time moved with it.
  expect(new Date(file.routeContext.statusCheckedAt).getTime()).toBeGreaterThan(
    opened.getTime() + 23 * 3600 * 1000,
  );
  expect(file.routeContext.statusAgeSeconds).toBeLessThan(120);
});

test("a loop the network cannot reach is labeled the closest available loop, with the requested and found distances", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("spinbutton", { name: "Custom miles" }).fill("40");
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
  await expect(
    page.getByText("Closest available loop", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Requested 40 mi · Found [\d.]+ mi$/),
  ).toBeVisible();
  // The presets are native's: 3, 5, 8 and 10 miles.
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  for (const miles of [3, 5, 8, 10])
    await expect(
      page.getByRole("button", { name: `${miles} mi`, exact: true }),
    ).toBeVisible();
});

test("Explore offers native's map controls: closure areas switch, Show all trails and the county map", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  const closures = page.getByRole("checkbox", {
    name: /Reported closure areas/,
  });
  await expect(closures).toBeChecked();
  await expect(page.getByText(/approximate work corridors/)).toBeVisible();
  await closures.uncheck();
  await expect(closures).not.toBeChecked();
  await closures.check();
  await expect(closures).toBeChecked();
  // Show all trails refits the map to the drawn trails and does not leave the page.
  const zoomBefore = await page.evaluate(
    () =>
      document.querySelector(".leaflet-container")?.getBoundingClientRect()
        .width,
  );
  await page
    .getByRole("button", { name: "Show all trails", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trails around you" }),
  ).toBeVisible();
  expect(zoomBefore).toBeGreaterThan(0);
  const county = page.getByRole("link", { name: /County map/ });
  await expect(county).toHaveAttribute(
    "href",
    /^https:\/\/mcleangis\.maps\.arcgis\.com\//,
  );
  await expect(county).toHaveAttribute("target", "_blank");
  await expect(county).toHaveAttribute("rel", /noopener/);
});

const libraryOf = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith("trail-mapper.web.library.v1"),
    )!;
    return JSON.parse(localStorage.getItem(key)!);
  });

test("a loop can be ridden in reverse and back, and Save keeps the planned direction", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: "3 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
  await expect(
    page.getByText("Planned direction", { exact: true }),
  ).toBeVisible();
  const planned = (await libraryOf(page)).recent[0];
  const firstLeg = (record: any) => record.route.segments[0].points.slice(0, 2);

  await page.getByRole("button", { name: "Reverse direction" }).click();
  await expect(
    page.getByText("Riding in reverse", { exact: true }),
  ).toBeVisible();
  // Reversing is not a new plan: nothing new enters the recent routes.
  expect((await libraryOf(page)).recent).toHaveLength(1);
  // Save stores the planned direction, as native does.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = (await libraryOf(page)).saved[0];
  expect(saved.key).toBe(planned.key);
  expect(firstLeg(saved)).toEqual(firstLeg(planned));

  await page.getByRole("button", { name: "Reverse direction" }).click();
  await expect(
    page.getByText("Planned direction", { exact: true }),
  ).toBeVisible();
});

test("only a loop offers reverse; a point-to-point route does not", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reverse direction" }),
  ).toHaveCount(0);
});

test("reversing during a ride starts that ride over in the new direction", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: "3 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await acceptedFix(page, 40.51, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await page.getByRole("button", { name: "Reverse direction" }).click();
  await expect(
    page.getByText("Riding in reverse", { exact: true }),
  ).toBeVisible();
  // Progress belongs to one direction: the ride starts over and needs a fresh fix.
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(1000);
  await acceptedFix(page, 40.51, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
});
