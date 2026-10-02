// The county build that ALSO packages the synthetic reviewed OpenStreetMap supplement (served on its own port by
// tests/support/serve-county.mjs --osm; see playwright.county.config.ts). Everything is synthetic: two self-authored
// "ways" with real geometry hashes. It proves the packaged supplement reaches the router, the map credit and the Help
// data section, and that identity moves with it, through the real built artifact.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const LIBRARY_KEY = "trail-mapper.county:trail-mapper.web.library.v1";
// The synthetic east path starts at the east trail corner and ends at (-88.93, 40.51): a destination only the
// supplement can reach.
const places = [
  ["west", "Synthetic west end", 40.5, -88.99],
  ["osm-end", "Synthetic OSM path end", 40.51, -88.93],
].map(([key, label, latitude, longitude]) => ({
  key,
  label,
  latitude,
  longitude,
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

test("the packaged supplement is in the data record, counted, hash-named and described", async ({
  page,
}) => {
  const record = await (await page.request.get("/data/dataset.json")).json();
  expect(record.content.featureCount).toBe(7);
  expect(record.content.layerCounts["verified-osm"]).toBe(2);
  expect(record.supplements).toHaveLength(1);
  expect(record.supplements[0]).toMatchObject({
    id: "osm-reviewed-ways",
    layerId: "verified-osm",
    featureCount: 2,
    license: "Open Database License (ODbL) 1.0",
    attribution: "© OpenStreetMap contributors",
  });
  // The reviewed exclusions travel with it: gaps stay gaps, and the record says so.
  expect(record.supplements[0].excludedUntilVerified.join(" ")).toContain(
    "do not bridge it",
  );
  const body = await (
    await page.request.get(`/data/${record.content.file}`)
  ).json();
  expect(body.layers.map((layer: { id: unknown }) => layer.id)).toEqual([
    8,
    "verified-osm",
  ]);
});

test("a destination only the reviewed OpenStreetMap path reaches can be planned, and Help and the map credit say where it came from", async ({
  page,
}) => {
  await seedPlaces(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  // The map credit names the supplement beside the county license, as a safe link.
  const credit = page.locator(".leaflet-control-attribution a", {
    hasText: "OpenStreetMap contributors / ODbL",
  });
  await expect(credit).toBeVisible();
  await expect(credit).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/copyright",
  );
  await expect(credit).toHaveAttribute("target", "_blank");
  await expect(credit).toHaveAttribute("rel", /noopener/);

  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Synthetic west end");
  await choose(page, "Destination", "Synthetic OSM path end");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  // The trail data plus the supplement make a mapped route to a point the county trails alone do not reach.
  await expect(page.getByText(/No route|could not be found/i)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();

  await page.getByRole("button", { name: /^Help/ }).first().click();
  const help = page.getByRole("dialog", { name: "Help and about" });
  await expect(help).toContainText(
    "7 existing trail features (2 of them reviewed OpenStreetMap paths",
  );
  await expect(help).toContainText("Reviewed OpenStreetMap paths:");
  await expect(
    help.getByRole("link", { name: "Open Database License (ODbL) 1.0" }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  // What the review keeps out is stated, not hidden.
  await expect(help).toContainText(
    "Included as a separate layer: 2 reviewed OpenStreetMap paths",
  );
  await expect(help).toContainText("do not bridge it");
});

test("the supplement changes the data identity a saved route remembers, and no accessibility violation appears in the data section", async ({
  page,
}) => {
  await seedPlaces(page);
  const record = await (await page.request.get("/data/dataset.json")).json();
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Synthetic west end");
  await choose(page, "Destination", "Synthetic OSM path end");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    LIBRARY_KEY,
  );
  expect(stored.saved[0].dataset.contentSha256).toBe(record.content.sha256);
  await page.getByRole("button", { name: /^Help/ }).first().click();
  await expect(
    page.getByRole("dialog", { name: "Help and about" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("control: the same journey on the county build WITHOUT the supplement cannot reach that destination as a mapped route", async ({
  browser,
}) => {
  const base = Number(process.env.TRAIL_TEST_PORT ?? 4175);
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${base}`,
  });
  const page = await context.newPage();
  await seedPlaces(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  // No supplement credit, and no supplement in the record.
  await expect(
    page.locator(".leaflet-control-attribution a", {
      hasText: "OpenStreetMap contributors / ODbL",
    }),
  ).toHaveCount(0);
  const record = await (await page.request.get("/data/dataset.json")).json();
  expect(record.supplements).toBeUndefined();
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Synthetic west end");
  await choose(page, "Destination", "Synthetic OSM path end");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  // Without the supplement the destination is off the network: no route, or a route that cannot be navigated.
  const start = page.getByRole("button", {
    name: "Start navigation",
    exact: true,
  });
  const noRoute = page.getByText(/No safe route|No route|could not be found/i);
  await expect(start.or(noRoute).first()).toBeVisible({ timeout: 15000 });
  if (await start.count()) await expect(start).toBeDisabled();
  await context.close();
});
