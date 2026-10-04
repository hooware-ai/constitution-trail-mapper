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

test("an obvious start connection is not announced, but it is still estimated: dashed on the map, counted, and Start stays blocked", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await planFromLocation(page, 40.489);
  // The start connection is obvious: no numbered notice and no numbered marker...
  await expect(
    page.getByRole("region", { name: /connections? to check/ }),
  ).toHaveCount(0);
  await expect(page.locator(".connection-marker")).toHaveCount(0);
  // ...but nothing is relabelled as confirmed: the route is still described as having unverified connections, drawn dashed.
  await expect(
    page.getByRole("region", {
      name: "Route map with unverified connections",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator('.map-wrap[data-estimated-connections="1"]'),
  ).toHaveCount(1);
  await expect(
    page.getByText(/unmapped ground|unsafe or unverified/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/still has estimated connections that are not confirmed/),
  ).toBeVisible();
  await page.screenshot({
    path: `output/playwright/access-gap-dashed-${info.project.name}.png`,
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
  expect(errors).toEqual([]);
});

test("a sub-foot start connection is still estimated and still blocks navigation", async ({
  page,
}) => {
  await planFromLocation(page, 40.489998);
  await expect(
    page.locator('.map-wrap[data-estimated-connections="1"]'),
  ).toHaveCount(1);
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
