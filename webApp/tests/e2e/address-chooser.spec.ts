import { test, expect, type Page } from "@playwright/test";
import {
  buildAddressIndex,
  serializeAddressIndex,
  type RawAddressRow,
} from "../../src/addressIndex";

// Synthetic county-style address rows only: nothing here is county data. The fixture build reads its index from
// data/address-index.fixture.json, which each test serves from memory (no network, no real file).
let oid = 0;
const row = (
  address: string,
  city: string,
  longitude: number,
  latitude: number,
  unit: string | null = null,
): RawAddressRow => ({
  oid: ++oid,
  address,
  building: null,
  unit,
  city,
  zip: "61761",
  longitude,
  latitude,
});
const indexText = serializeAddressIndex(
  buildAddressIndex([
    // The same address at two recorded points in one city, and again in another city.
    row("421 N Main St", "Normal", -88.95, 40.51, "A"),
    row("421 N Main St", "Normal", -88.93, 40.49, "B"),
    row("421 N Main St", "Bloomington", -88.99, 40.48),
    // A point about 365 ft from the nearest mapped trail: an estimated, unverified connection.
    row("100 Test Ave", "Normal", -88.95, 40.489),
  ]).data,
);

async function serveIndex(page: Page) {
  const requests: string[] = [];
  await page.route("**/data/address-index.fixture.json", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: "application/json", body: indexText });
  });
  return requests;
}
async function openChooser(page: Page, field: "Start" | "Destination") {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page
    .getByRole("button", { name: new RegExp("^" + field + ":") })
    .click();
}
const search = (page: Page) =>
  page.getByRole("textbox", { name: "Search places" });

test("address data is requested only when an address is typed, and other places keep working", async ({
  page,
}) => {
  const requests = await serveIndex(page);
  await openChooser(page, "Start");
  await search(page).fill("Review trailhead");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /^Review trailhead · East/ }),
  ).toBeVisible();
  await search(page).fill("Normal Public Library");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /^Normal Public Library/ }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  for (const name of ["Use current location", "Pick on map"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await search(page).fill("421 n main");
  await expect(
    page.getByRole("region", { name: "County address results" }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
});

for (const field of ["Start", "Destination"] as const) {
  test(`${field}: two distinct points for one address are separate, labelled choices, and either can be chosen`, async ({
    page,
  }) => {
    await serveIndex(page);
    await openChooser(page, field);
    await search(page).fill("421 n main st");
    const results = page.getByRole("region", {
      name: "County address results",
    });
    await expect(results).toContainText("3 county address points match");
    await expect(results).toContainText("not verified trail entrances");
    const choices = results.getByRole("button");
    await expect(choices).toHaveCount(3);
    const normal = results.getByRole("button", { name: /Normal/ });
    await expect(normal).toHaveCount(2);
    await expect(normal.nth(0)).toContainText(
      "County address point · not a verified trail entrance",
    );
    await expect(normal.nth(0)).toContainText(/Point \d of 3/);
    await expect(normal.nth(0)).toContainText("Units: A");
    await expect(normal.nth(1)).toContainText("Units: B");
    await expect(
      results.getByRole("button", { name: /Bloomington/ }),
    ).toContainText("County address point");
    const detail0 = await normal.nth(0).textContent();
    const detail1 = await normal.nth(1).textContent();
    expect(detail0).not.toEqual(detail1);
    await normal.nth(1).click();
    await expect(
      page.getByRole("button", {
        name: new RegExp("^" + field + ": 421 N Main St"),
      }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("an address endpoint far from any mapped trail keeps its unverified connection and Start stays blocked", async ({
  page,
}) => {
  await serveIndex(page);
  await openChooser(page, "Start");
  await search(page).fill("100 test ave");
  await page
    .getByRole("region", { name: "County address results" })
    .getByRole("button", { name: /100 Test Ave/ })
    .click();
  await page.getByRole("button", { name: /^Destination:/ }).click();
  await search(page).fill("Review trailhead · East");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Review trailhead · East/ })
    .click();
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  // The address point was not moved onto a trail: the connection is still there, measured, and still blocks Start.
  const details = page.getByRole("region", { name: "1 connection to check" });
  await expect(details).toContainText("365 ft");
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeDisabled();
});

test("when the address data cannot be loaded the chooser says so and every other way to choose still works", async ({
  page,
}) => {
  await page.route("**/data/address-index.fixture.json", (route) =>
    route.fulfill({ status: 404, body: "no" }),
  );
  await openChooser(page, "Start");
  await search(page).fill("421 n main");
  await expect(
    page.getByText(/county address data could not be loaded/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pick on map", exact: true }),
  ).toBeVisible();
  await search(page).fill("Review trailhead · East");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /^Review trailhead · East/ }),
  ).toBeVisible();
});
