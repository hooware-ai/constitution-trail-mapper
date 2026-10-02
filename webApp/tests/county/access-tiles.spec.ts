// The county build that ALSO packages SYNTHETIC ordinary-road access as base roads plus on-demand service-road tiles
// (served on its own port by tests/support/serve-county.mjs --access; see playwright.county.config.ts). It proves, through
// the real built artifact, that opening the planner downloads no service-road tiles, that a trip downloads and verifies
// only the tiles around its endpoints, that a failed or corrupted download is reported and retried, and that Help and the
// map credit say where the road data came from.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { accessPlaces } from "../support/access-fixture.mjs";

const LIBRARY_KEY = "trail-mapper.county:trail-mapper.web.library.v1";
const places = [accessPlaces.start, accessPlaces.end].map((p, i) => ({
  key: i === 0 ? "start" : "end",
  ...p,
  createdAt: 1,
}));

async function seedPlaces(page: Page) {
  await page.addInitScript(
    ({ key, places }) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, saved: [], recent: [], places }),
      );
    },
    { key: LIBRARY_KEY, places },
  );
}
const requested = (page: Page) => {
  const urls: string[] = [];
  page.on("request", (request) => {
    const match = /\/data\/(access-[^/?]+)/.exec(request.url());
    if (match) urls.push(match[1]);
  });
  return urls;
};
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
async function openPlanner(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", accessPlaces.start.label);
  await choose(page, "Destination", accessPlaces.end.label);
}
const findRoute = (page: Page) =>
  page.getByRole("button", { name: "Find route", exact: true });

test("opening the planner downloads the base roads and no service-road tile or index", async ({
  page,
}) => {
  await seedPlaces(page);
  const files = requested(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  expect(files.filter((f) => f.startsWith("access-base."))).toHaveLength(1);
  expect(files.filter((f) => f.startsWith("access-tile."))).toEqual([]);
  expect(files.filter((f) => f.startsWith("access-index."))).toEqual([]);
});

test("a trip downloads the index and only the tiles around its endpoints, and the road access is routed", async ({
  page,
}) => {
  await seedPlaces(page);
  const files = requested(page);
  await openPlanner(page);
  await findRoute(page).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  // The service road is the only way from the cul-de-sac to the trail, so a navigable route proves the tiles reached the
  // router, were verified, and were used.
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  expect(files.some((f) => f.startsWith("access-index."))).toBe(true);
  const tiles = files.filter((f) => f.startsWith("access-tile."));
  expect(tiles.length).toBeGreaterThan(0);
  expect(tiles.length).toBeLessThanOrEqual(18);
  // The distant service road's tile (around 40.3, -88.5) is never asked for.
  expect(tiles.some((f) => f.startsWith("access-tile.4030_"))).toBe(false);
});

test("a tile that cannot be downloaded is reported, and the next attempt succeeds", async ({
  page,
}) => {
  await seedPlaces(page);
  await openPlanner(page);
  await page.route("**/data/access-tile.*", (route) => route.abort());
  await findRoute(page).click();
  await expect(
    page.getByText(/could not be downloaded|Check your connection/i).first(),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toHaveCount(0);
  // A failed download is retryable, so the failure offers Try again; once back online that very button succeeds.
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeVisible();
  await page.unroute("**/data/access-tile.*");
  await retry.click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
});

test("a tile whose bytes were altered fails its hash and is not used", async ({
  page,
}) => {
  await seedPlaces(page);
  await openPlanner(page);
  await page.route("**/data/access-tile.*", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    const altered = Buffer.from(body);
    altered[altered.length - 3] ^= 1; // same size, different content
    await route.fulfill({ response, body: altered });
  });
  await findRoute(page).click();
  await expect(page.getByText(/integrity check/i).first()).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/data/access-tile.*");
  await findRoute(page).click();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
});

test("Help and the map credit say where the road data came from, with no accessibility violation", async ({
  page,
}) => {
  await seedPlaces(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  const credit = page.locator(".leaflet-control-attribution a", {
    hasText: "OpenStreetMap contributors / ODbL",
  });
  await expect(credit).toBeVisible();
  await page.getByRole("button", { name: /^Help/ }).first().click();
  const help = page.getByRole("dialog", { name: "Help and about" });
  await expect(help).toContainText("Road access:");
  await expect(help).toContainText("service roads load only for the area");
  await expect(
    help.getByRole("link", { name: /OpenStreetMap contributors \(ODbL\)/ }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("Explore draws the reported closure and its switch hides and shows it", async ({
  page,
}) => {
  await seedPlaces(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  const closures = page.getByRole("checkbox", {
    name: /Reported closure areas/,
  });
  const markers = page.locator(".closure-marker");
  await expect(closures).toBeChecked();
  await expect(markers).toHaveCount(1);
  await closures.uncheck();
  await expect(markers).toHaveCount(0);
  await closures.check();
  await expect(markers).toHaveCount(1);
});

test("control: the same journey on the build WITHOUT access data cannot be navigated", async ({
  browser,
}) => {
  const base = Number(process.env.TRAIL_TEST_PORT ?? 4175);
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${base}`,
  });
  const page = await context.newPage();
  await seedPlaces(page);
  const files = requested(page);
  await openPlanner(page);
  await findRoute(page).click();
  const start = page.getByRole("button", {
    name: "Start navigation",
    exact: true,
  });
  const noRoute = page.getByText(/No safe route|No route|could not be found/i);
  await expect(start.or(noRoute).first()).toBeVisible({ timeout: 15000 });
  if (await start.count()) await expect(start).toBeDisabled();
  expect(files).toEqual([]);
  await context.close();
});
