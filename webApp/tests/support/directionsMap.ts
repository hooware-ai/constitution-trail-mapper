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
  const lastPoint = await page.evaluate(
    (index) => (window as any).__directions[index].point,
    count - 1,
  );
  await expect(page.locator(".map")).toHaveAttribute(
    "data-center",
    `${lastPoint.latitude.toFixed(4)},${lastPoint.longitude.toFixed(4)}`,
  );
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Show step 1 on map", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(marker).toHaveCount(1);
  await expect(marker).toBeVisible();
  await expect(marker).toBeFocused();
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
