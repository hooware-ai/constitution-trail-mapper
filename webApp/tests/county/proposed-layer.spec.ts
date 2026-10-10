// The county build that ALSO packages SYNTHETIC proposed trail segments through the rights-gated seam (served on its own
// port by tests/support/serve-county.mjs --proposed; see playwright.county.config.ts). The segments are a separate
// layer, off unless the rider opts in, and a route over them is a preview that cannot start navigation. The control
// runs the standard county build, which carries no proposed layer, and must say so instead of offering a dead switch.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { proposedPlace } from "../support/proposed-fixture.mjs";

const LIBRARY_KEY = "trail-mapper.county:trail-mapper.web.library.v1";
const places = [
  ["start", "Synthetic west trail east end", 40.5, -88.97],
  ["end", proposedPlace.label, proposedPlace.latitude, proposedPlace.longitude],
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
async function openPlanner(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", places[0].label as string);
  await choose(page, "Destination", places[1].label as string);
}
const findRoute = (page: Page) =>
  page.getByRole("button", { name: "Find route", exact: true });
const proposedBox = (page: Page) =>
  page.getByRole("checkbox", { name: /Include proposed trails/ });

test("the proposed layer is off by default: without the opt-in the proposed end cannot be navigated to", async ({
  page,
}) => {
  await seedPlaces(page);
  await openPlanner(page);
  await expect(proposedBox(page)).toBeEnabled();
  await expect(proposedBox(page)).not.toBeChecked();
  await findRoute(page).click();
  const start = page.getByRole("button", {
    name: "Start navigation",
    exact: true,
  });
  const noRoute = page.getByText(/No safe route|No route|could not be found/i);
  await expect(start.or(noRoute).first()).toBeVisible({ timeout: 15000 });
  if (await start.count()) await expect(start).toBeDisabled();
  // A search that found nothing gives the same answer if asked again, so it does not offer Try again.
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toHaveCount(0);
});

test("with the explicit opt-in the proposed segments are routed as a preview that cannot start navigation", async ({
  page,
}) => {
  await seedPlaces(page);
  await openPlanner(page);
  await proposedBox(page).check();
  await findRoute(page).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeDisabled();
  // The preview says why, in words, near the controls.
  await expect(page.getByText(/proposed/i).first()).toBeVisible();
});

test("Help lists the proposed layer with the rights it was admitted under, and has no accessibility violation", async ({
  page,
}) => {
  await seedPlaces(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Help/ }).first().click();
  const help = page.getByRole("dialog", { name: "Help and about" });
  await expect(help).toContainText("Proposed trails (preview only):");
  await expect(help).toContainText("2 planned segments");
  // The total in the record includes the proposed segments; the "existing" label must not.
  const record = await (await page.request.get("/data/dataset.json")).json();
  expect(record.content.featureCount).toBe(
    record.content.featureCount - record.proposedLayer.featureCount + 2,
  );
  const existing =
    record.content.featureCount - record.proposedLayer.featureCount;
  await expect(help).toContainText(
    `${existing} existing trail features, plus 2 proposed segments (preview only, below)`,
  );
  await expect(help).not.toContainText(
    `${record.content.featureCount} existing trail features`,
  );
  await expect(help).toContainText(
    "2 proposed features are loaded too, hidden unless you turn them on",
  );
  await expect(
    help.getByRole("link", { name: "Synthetic Open License 1.0" }),
  ).toHaveAttribute("href", "https://example.test/synthetic/license");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("control: the standard county build has no proposed layer, and the switch says so instead of doing nothing", async ({
  browser,
}) => {
  const base = Number(process.env.TRAIL_TEST_PORT ?? 4175);
  const context = await browser.newContext({
    baseURL: `http://127.0.0.1:${base}`,
  });
  const page = await context.newPage();
  await seedPlaces(page);
  await openPlanner(page);
  const box = proposedBox(page);
  await expect(box).toBeDisabled();
  await expect(box).not.toBeChecked();
  await expect(page.getByText(/no proposed trails/i).first()).toBeVisible();
  await page
    .getByRole("button", { name: "Trail Mapper home", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  const summary = page.getByText("Layers and map key", { exact: true });
  await expect(summary).toHaveAccessibleDescription(
    "Closure areas shown · Proposed trails unavailable in this data",
  );
  await summary.click();
  await expect(
    page.getByRole("checkbox", { name: /Show proposed trails/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: /Show proposed trails/ }),
  ).not.toBeChecked();
  await context.close();
});
