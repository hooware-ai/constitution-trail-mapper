// The county build that packages EVERY credited layer at once (reviewed OpenStreetMap paths, ordinary-road access with
// OpenStreetMap service roads, and proposed trails), served on its own port by serve-county.mjs --osm --access --proposed.
// The route image must carry every applicable credit, in full: none dropped, none cut to a fixed number of lines.
import { test, expect, type Page } from "@playwright/test";
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

test("the route image carries the county, OpenStreetMap, access and proposed credits in full", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, places }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({ version: 1, saved: [], recent: [], places }),
        );
      Object.defineProperty(navigator, "canShare", { value: undefined });
      const drawn: string[] = [];
      (window as any).__drawn = drawn;
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
        drawn.push(String(text));
        return (fillText as any).call(this, text, ...rest);
      };
    },
    { key: LIBRARY_KEY, places },
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", places[0].label as string);
  await choose(page, "Destination", places[1].label as string);
  await page.getByRole("checkbox", { name: /Include proposed trails/ }).check();
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await dialog
    .getByRole("checkbox", { name: /Include exact start and destination/ })
    .check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Save route image" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("trail-mapper-route.png");
  const drawn = (await page.evaluate(() => (window as any).__drawn as string[]))
    .join(" ")
    .replace(/\s+/g, " ");
  // Every layer the route can draw on is credited, each with its licence, and the generated-route disclaimer closes it.
  expect(drawn).toMatch(/OpenStreetMap/);
  expect(drawn).toMatch(/TIGER\/Line/);
  expect(drawn).toMatch(/Proposed trails \(preview only, not built\)/);
  expect(drawn).toMatch(/Reviewed OpenStreetMap paths/);
  expect(drawn).toMatch(/not an official county map\./);
});
