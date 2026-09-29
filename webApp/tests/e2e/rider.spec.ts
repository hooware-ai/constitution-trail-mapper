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
