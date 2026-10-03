import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function planFromLocation(page: Page, latitude: number) {
  await page.addInitScript((latitude) => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(success: PositionCallback) {
          success({
            coords: { latitude, longitude: -88.95, accuracy: 5 },
            timestamp: Date.now(),
          } as GeolocationPosition);
          return 1;
        },
        clearWatch() {},
      },
    });
  }, latitude);
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
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
}

test("unverified connections have measured details and accessible map focus", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await planFromLocation(page, 40.489);
  const details = page.getByRole("region", { name: "1 connection to check" });
  await expect(details).toContainText("365 ft");
  await expect(
    page.getByText(/unmapped ground|unsafe or unverified/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeDisabled();
  const show = details.getByRole("button", {
    name: /Show connection 1: Start connection/,
  });
  await show.press("Enter");
  const map = page.getByRole("region", {
    name: "Route map with unverified connections",
    exact: true,
  });
  const marker = map.getByRole("button", {
    name: /Connection 1: Start connection/,
  });
  await expect(marker).toBeFocused();
  await expect(page.locator(".leaflet-popup")).toContainText(
    "Map data does not confirm a traversable connection here",
  );
  const box = await marker.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  await page
    .getByRole("button", { name: "Close popup", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "Fit route", exact: true }).click();
  await show.press("Enter");
  await expect(marker).toBeFocused();
  await expect(page.locator(".leaflet-popup")).toBeVisible();
  await page.screenshot({
    path: `output/playwright/access-gap-focus-${info.project.name}.png`,
    fullPage: true,
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page
    .getByRole("button", { name: "Recalculate route", exact: true })
    .click();
  // The still-unverified connection means the temporary result cannot be started, and it says so.
  await expect(
    page.getByText(
      /A recalculated route was found but it cannot be started yet/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("sub-foot connection is visible and still blocks navigation", async ({
  page,
}) => {
  await planFromLocation(page, 40.489998);
  const details = page.getByRole("region", { name: "1 connection to check" });
  await expect(details).toContainText("Less than 1 ft total");
  await expect(details).toContainText("<1 ft");
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeDisabled();
});

test("fully mapped route has no connection notice or markers", async ({
  page,
}) => {
  await planFromLocation(page, 40.49);
  await expect(
    page.getByRole("region", { name: /connections? to check/ }),
  ).toHaveCount(0);
  await expect(page.locator(".connection-marker")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
});
