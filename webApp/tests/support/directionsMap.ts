import { test, expect } from "@playwright/test";
import { planPoint } from "../webkit/support";

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

test("[engine] itinerary distances follow real loop instruction legs and regenerate on reverse", async ({
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
    await expect(dialog.locator("ol li > span").last()).toHaveText(
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
      await expect(dialog.locator("ol li > span").nth(index)).toHaveText(
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
