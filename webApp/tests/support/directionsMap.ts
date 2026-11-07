import { test, expect } from "@playwright/test";
import { planPoint, simulateDevice } from "../webkit/support";

test("[engine] preview directions can locate a real maneuver without changing the route", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.result?.instructions) {
            (window as any).__directions = data.result.instructions;
            (window as any).__directionsCount =
              ((window as any).__directionsCount ?? 0) + 1;
          }
        });
      }
    } as typeof Worker;
  });
  await planPoint(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem(
              "trail-mapper.fixture:trail-mapper.web.session.v1",
            ) ?? "null",
          )?.selected != null,
      ),
    )
    .toBe(true);
  const routeBefore = await page.evaluate(() =>
    localStorage.getItem("trail-mapper.fixture:trail-mapper.web.session.v1"),
  );
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Directions" });
  await expect(dialog.locator("ol li").first()).toBeVisible();
  const count = await dialog.locator("ol li").count();
  expect(count).toBeGreaterThan(1);
  const lastText = await dialog.locator("ol li strong").last().innerText();
  const instructions = await page.evaluate(() => (window as any).__directions);
  expect(instructions).toHaveLength(count);
  expect(instructions[count - 1].text).toBe(lastText);
  await dialog
    .getByRole("button", { name: `Show step ${count} on map`, exact: true })
    .click();
  const marker = page.locator(".instruction-marker");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute(
    "aria-label",
    `Step ${count}: ${lastText}`,
  );
  await expect(marker).toBeInViewport();
  // Check again after rendering settles: mobile focus can restore an old viewport on the next frame.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(marker).toBeInViewport();
  const lastPoint = await page.evaluate(
    (index) => (window as any).__directions[index].point,
    count - 1,
  );
  await expect(page.locator(".map")).toHaveAttribute(
    "data-center",
    `${lastPoint.latitude.toFixed(4)},${lastPoint.longitude.toFixed(4)}`,
  );
  // Once located, scrolling is still the user's choice; the reveal must not pull them back to the map.
  if (
    await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    )
  ) {
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(scrollBefore);
    await expect(marker).not.toBeInViewport();
  }
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  const restoredStep = dialog.getByRole("button", {
    name: `Show step ${count} on map`,
    exact: true,
  });
  await expect(restoredStep).toBeFocused();
  await expect(restoredStep).toBeInViewport();
  const lastDistance = await dialog.locator("ol li span").last().innerText();
  await expect(restoredStep).toHaveAccessibleDescription(
    `${lastText} ${lastDistance}`,
  );
  await expect(page.locator(".map")).toHaveAttribute(
    "data-center",
    `${lastPoint.latitude.toFixed(4)},${lastPoint.longitude.toFixed(4)}`,
  );
  await dialog
    .getByRole("button", { name: "Show step 1 on map", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(marker).toHaveCount(1);
  await expect(marker).toBeVisible();
  await expect(marker).toBeFocused();
  await expect(marker).toBeInViewport();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(marker).toBeInViewport();
  await expect(marker).toHaveAttribute("aria-label", /^Step 1:/);
  const point = await page.evaluate(
    () => (window as any).__directions[0].point,
  );
  await expect(page.locator(".map")).toHaveAttribute(
    "data-center",
    `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`,
  );
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await page.getByRole("button", { name: "Close Directions" }).click();
  await expect(marker).toBeVisible();
  await expect(page.locator(".map")).toHaveAttribute(
    "data-center",
    `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`,
  );
  const routeAfter = await page.evaluate(() =>
    localStorage.getItem("trail-mapper.fixture:trail-mapper.web.session.v1"),
  );
  expect(JSON.parse(routeAfter!).selected.route).toEqual(
    JSON.parse(routeBefore!).selected.route,
  );
  const resultsBefore = await page.evaluate(
    () => (window as any).__directionsCount,
  );
  await page
    .getByRole("button", { name: "Recalculate route", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__directionsCount))
    .toBeGreaterThan(resultsBefore);
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(marker).toHaveCount(0);
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Close Directions" }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Show step 1 on map", exact: true })
    .click();
  await expect(marker).toHaveCount(1);
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await expect(marker).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("[engine] entering navigation clears preview selection and leaves directions read-only", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await planPoint(page);
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await page
    .getByRole("button", { name: "Show step 1 on map", exact: true })
    .click();
  await expect(page.locator(".instruction-marker")).toBeVisible();
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop navigation", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".instruction-marker")).toHaveCount(0);
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Directions" });
  await expect(dialog.locator("ol li").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Show step/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Close Directions" }).click();
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  expect(errors).toEqual([]);
});

// Delay only the real lazy module, not the app or its click handler. Each case
// releases it between native pointerdown/up at the ORIGINAL screen coordinates.
// Both Chromium and WebKit import this support file. These are engine/layout
// checks, not physical touch-device or GPS acceptance.
for (const { name, width, height, fontSize, oldLayout } of [
  { name: "a narrow phone", width: 320, height: 568, fontSize: 16 },
  {
    name: "a narrow phone at 200% text",
    width: 320,
    height: 568,
    fontSize: 32,
  },
  {
    name: "short landscape at 200% text",
    width: 640,
    height: 320,
    fontSize: 32,
  },
  {
    name: "negative control: the original dock loses the tap",
    width: 320,
    height: 568,
    fontSize: 16,
    oldLayout: true,
  },
]) {
  test(`[sim-device] Directions survives lazy map mounting during a held pointer: ${name}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await simulateDevice(page);
    let releaseModule!: () => void;
    const moduleGate = new Promise<void>((resolve) => {
      releaseModule = resolve;
    });
    let moduleRequests = 0;
    await page.route(/\/src\/RideMap\.tsx(?:\?|$)/, async (route) => {
      moduleRequests++;
      await moduleGate;
      await route.continue();
    });
    const restoreLayout = async () => {
      if (!oldLayout) return;
      await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>(".ride-dock-body");
        const directions = document.querySelector(".ride-directions");
        if (body && directions) {
          body.append(directions);
          body.style.removeProperty("display");
          body.parentElement!.style.removeProperty("min-height");
        }
      });
    };
    try {
      await planPoint(page);
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}px`;
      }, fontSize);
      await page
        .getByRole("button", { name: "Start navigation", exact: true })
        .click();
      await expect(
        page.getByText("Opening ride map…", { exact: true }),
      ).toBeVisible();
      await expect.poll(() => moduleRequests).toBe(1);
      await expect(page.locator(".ride-map-tools > *")).toHaveCount(0);

      if (oldLayout) {
        // TEST-ONLY NEGATIVE CONTROL. Recreate the prior layout: Directions
        // precedes the async tools inside the bottom-anchored auto-height scroller.
        // Production cases above do not modify app markup or CSS.
        await page.evaluate(() => {
          const content = document.querySelector(".ride-dock-content")!;
          const progress = document.querySelector(".ride-progress")!;
          const body = document.querySelector<HTMLElement>(".ride-dock-body");
          if (body) {
            body.style.display = "contents";
            body.parentElement!.style.minHeight = "0";
          }
          progress.append(document.querySelector(".ride-directions")!);
          content.insertBefore(
            progress,
            content.querySelector(".navigation-beta-note, .ride-map-tools"),
          );
        });
      }

      const directions = page.getByRole("button", {
        name: "Directions",
        exact: true,
      });
      await directions.scrollIntoViewIfNeeded();
      await expect(directions).toBeInViewport({ ratio: 1 });
      const before = (await directions.boundingBox())!;
      const point = {
        x: before.x + before.width / 2,
        y: before.y + before.height / 2,
      };
      expect(
        await directions.evaluate(
          (button, p) => button.contains(document.elementFromPoint(p.x, p.y)),
          point,
        ),
        "The original press point hits Directions",
      ).toBe(true);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      releaseModule();
      try {
        await expect(
          page.locator(".ride-map-tools .ride-map-control"),
        ).toBeVisible();
        await expect(
          page.locator(".ride-map-tools .ride-credit"),
        ).toContainText("Synthetic review geometry");
        await expect(
          page.getByText("Opening ride map…", { exact: true }),
        ).toHaveCount(0);
        const after = (await directions.boundingBox())!;
        if (oldLayout) {
          expect(
            before.y - after.y,
            "The old layout moves the button beyond the held pointer",
          ).toBeGreaterThan(before.height / 2);
          expect(
            await directions.evaluate(
              (button, p) =>
                button.contains(document.elementFromPoint(p.x, p.y)),
              point,
            ),
          ).toBe(false);
        } else {
          for (const edge of ["x", "y", "width", "height"] as const)
            expect
              .soft(
                Math.abs(after[edge] - before[edge]),
                `Directions ${edge} stays fixed while the pointer is held`,
              )
              .toBeLessThanOrEqual(1);
          expect
            .soft(
              await directions.evaluate(
                (button, p) =>
                  button.contains(document.elementFromPoint(p.x, p.y)),
                point,
              ),
              "The release point still hits Directions",
            )
            .toBe(true);
        }
      } finally {
        // No locator.click(): it would retarget the moved button and mask the race.
        await page.mouse.up();
      }
      const dialog = page.getByRole("dialog", { name: "Directions" });
      if (oldLayout) {
        await expect(dialog).not.toBeVisible();
        // Restore React's real parent before any further renders or unmounting.
        await restoreLayout();
        // Prove the negative control loses this tap, rather than breaking the dialog.
        await directions.click();
      }
      await expect(dialog.locator("ol li").first()).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: /Show step/ }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Close Directions" }).click();
      await page
        .getByRole("button", { name: "Stop navigation", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Start navigation", exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      releaseModule();
      await restoreLayout();
    }
  });
}

test("[engine] short large-text directions reveal the selected maneuver on return", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 320 });
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.fontSize = "150%";
    });
  });
  await planPoint(page);
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Directions" });
  const steps = dialog.getByRole("button", { name: /^Show step/ });
  const count = await steps.count();
  expect(count).toBeGreaterThan(1);
  await steps.last().click();
  const center = await page.locator(".map").getAttribute("data-center");
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await expect(steps.last()).toBeFocused();
  // A button can intersect the viewport while clipped by the scrollable dialog.
  const geometry = await steps.last().evaluate((button) => {
    const modal = button.closest("dialog")!;
    const b = button.getBoundingClientRect(),
      d = modal.getBoundingClientRect();
    return {
      top: b.top,
      bottom: b.bottom,
      dialogTop: d.top,
      dialogBottom: d.bottom,
      scrollable: modal.scrollHeight > modal.clientHeight,
    };
  });
  expect(geometry.scrollable).toBe(true);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.dialogTop);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.dialogBottom);
  await expect(page.locator(".map")).toHaveAttribute("data-center", center!);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".map")).toHaveAttribute("data-center", center!);
});

test("[engine] itinerary distances and landscape density follow a real loop and survive reversal", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.result?.instructions) {
            (window as any).__itineraryResult = data.result;
            (window as any).__itineraryCount =
              ((window as any).__itineraryCount ?? 0) + 1;
          }
        });
      }
    } as typeof Worker;
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page
    .getByRole("textbox", { name: "Search places" })
    .fill("Review trailhead · East");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Review trailhead · East/ })
    .click();
  await page.getByRole("button", { name: "5 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  async function checkItinerary() {
    const result = await page.evaluate(() => (window as any).__itineraryResult);
    expect(result.instructions.length).toBeGreaterThan(2);
    const total = result.instructions.reduce(
      (sum: number, step: any) => sum + step.distance,
      0,
    );
    // This fixture has several legs: the final leg is not the distance from start.
    expect(total - result.instructions.at(-1).distance).toBeGreaterThan(160);
    await page.getByRole("button", { name: "Directions", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Directions" });
    for (let index = 0; index < result.instructions.length; index++) {
      const item = dialog.locator("ol li").nth(index);
      await expect(item.locator("strong")).toHaveText(
        result.instructions[index].text,
      );
      await expect(item.locator("svg.maneuver-icon")).toHaveAttribute(
        "data-maneuver",
        result.instructions[index].maneuver,
      );
      await expect(item.locator("svg.maneuver-icon")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      await expect(item.locator("svg.maneuver-icon")).toHaveAttribute(
        "focusable",
        "false",
      );
    }
    await expect(dialog.locator(".direction-distance").last()).toHaveText(
      `${(total / 1609.344).toFixed(1)} mi from start · Last step`,
    );
    let cumulative = 0;
    for (let index = 0; index < result.instructions.length; index++) {
      cumulative += result.instructions[index].distance;
      const format = (meters: number) =>
        meters < 160.9344
          ? `${Math.round(meters * 3.28084)} ft`
          : `${(meters / 1609.344).toFixed(1)} mi`;
      const next =
        index + 1 < result.instructions.length
          ? `${format(result.instructions[index + 1].distance)} to next step`
          : "Last step";
      const distance = `${format(cumulative)} from start · ${next}`;
      await expect(dialog.locator(".direction-distance").nth(index)).toHaveText(
        distance,
      );
      const button = dialog.getByRole("button", {
        name: `Show step ${index + 1} on map`,
        exact: true,
      });
      await expect(button).toHaveAccessibleDescription(
        `${result.instructions[index].text} ${distance}`,
      );
    }
    await page.getByRole("button", { name: "Close Directions" }).click();
    return result.instructions;
  }
  const before = await checkItinerary();
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 640, height: 320 });
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  const landscape = page.getByRole("dialog", { name: "Directions" });
  const geometry = await landscape.evaluate((dialog) => {
    const bounds = dialog.getBoundingClientRect();
    const rows = [...dialog.querySelectorAll("ol li")].map((row) =>
      row.getBoundingClientRect(),
    );
    return {
      width: bounds.width,
      viewportWidth: innerWidth,
      inViewport:
        bounds.left >= 0 &&
        bounds.right <= innerWidth &&
        bounds.top >= 0 &&
        bounds.bottom <= innerHeight,
      scrollable:
        /auto|scroll/.test(getComputedStyle(dialog).overflowY) &&
        dialog.scrollHeight > dialog.clientHeight,
      horizontalOverflow: dialog.scrollWidth > dialog.clientWidth,
      fullRows: rows.filter(
        (row) => row.top >= bounds.top && row.bottom <= bounds.bottom,
      ).length,
      nestedScrollers: [...dialog.querySelectorAll("*")].filter((child) => {
        const style = getComputedStyle(child);
        return (
          /auto|scroll/.test(style.overflowY) &&
          child.scrollHeight > child.clientHeight
        );
      }).length,
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(geometry.viewportWidth - 25);
  expect(geometry.inViewport).toBe(true);
  expect(geometry.scrollable).toBe(true);
  expect(geometry.horizontalOverflow).toBe(false);
  expect(geometry.fullRows).toBeGreaterThanOrEqual(3);
  expect(geometry.nestedScrollers).toBe(0);
  await expect(landscape.getByRole("listitem")).toHaveCount(before.length);
  const originalFont = await page.evaluate(
    () => document.documentElement.style.fontSize,
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "150%";
  });
  const largeText = await landscape.evaluate((dialog) => ({
    overflow: dialog.scrollWidth > dialog.clientWidth,
    controls: [...dialog.querySelectorAll("ol button")].map((button) => {
      const box = button.getBoundingClientRect(),
        bounds = dialog.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        insideWidth: box.left >= bounds.left && box.right <= bounds.right,
      };
    }),
  }));
  expect(largeText.overflow).toBe(false);
  for (const control of largeText.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.insideWidth).toBe(true);
  }
  await landscape
    .getByRole("button", { name: /^Show step/ })
    .last()
    .focus();
  const lastVisible = await landscape
    .getByRole("button", { name: /^Show step/ })
    .last()
    .evaluate((button) => {
      const row = button.getBoundingClientRect(),
        bounds = button.closest("dialog")!.getBoundingClientRect();
      return row.top >= bounds.top && row.bottom <= bounds.bottom;
    });
  expect(lastVisible).toBe(true);
  await page.getByRole("button", { name: "Close Directions" }).click();
  await page.evaluate((font) => {
    document.documentElement.style.fontSize = font;
  }, originalFont);
  await page.setViewportSize(originalViewport);
  const countBefore = await page.evaluate(
    () => (window as any).__itineraryCount,
  );
  await page
    .getByRole("button", { name: "Reverse direction", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__itineraryCount))
    .toBeGreaterThan(countBefore);
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  const after = await checkItinerary();
  expect(after).not.toEqual(before);
  expect(errors).toEqual([]);
});
