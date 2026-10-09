import { test, expect } from "@playwright/test";

// The public-channel build of the (unapproved, synthetic) package: it must refuse to show the data at all.
const port = Number(process.env.TRAIL_TEST_PORT ?? 4175) + 1;
test.use({ baseURL: `http://127.0.0.1:${port}` });

test("a public build refuses data that is not approved, shows why, and offers no fixture or partial map", async ({
  page,
}) => {
  await page.goto("/");
  const alert = page.getByRole("alert").filter({ hasText: "could not load" });
  await expect(alert).toContainText("has not been approved for public use");
  await expect(page.getByText("Review trailhead")).toHaveCount(0);
  await expect(page.locator(".review-banner")).not.toContainText("Synthetic");
  await expect(page.getByRole("button", { name: /Go somewhere/ })).toHaveCount(
    0,
  );
  await alert.getByRole("button", { name: "Retry loading" }).click();
  await expect(alert).toContainText("has not been approved for public use");
});

// These positive runtime controls approve only the self-authored fixture descriptor at the loader seam.
// They do not approve the fixture artifact for real publication; the actual release has its separate strict artifact audit.
async function approvedPublicFixture(page: import("@playwright/test").Page) {
  const record = await (await page.request.get("/data/dataset.json")).json();
  await page.route("**/data/dataset.json", (route) =>
    route.fulfill({
      json: {
        ...record,
        approval: {
          approved: true,
          approvedBy: "Synthetic test operator",
          approvedOn: "2026-10-09",
          approvedComposition: record.composition,
          blockers: [],
        },
      },
    }),
  );
  await page.addInitScript(() => {
    if (localStorage.getItem("trail-mapper.county:trail-mapper.web.library.v1"))
      return;
    localStorage.setItem(
      "trail-mapper.county:trail-mapper.web.library.v1",
      JSON.stringify({
        version: 1,
        saved: [],
        recent: [],
        places: [
          {
            key: "west",
            label: "Synthetic west end",
            latitude: 40.5,
            longitude: -88.99,
            createdAt: 1,
          },
          {
            key: "north",
            label: "Synthetic north end",
            latitude: 40.52,
            longitude: -88.97,
            createdAt: 1,
          },
          {
            key: "off",
            label: "Synthetic off-trail start",
            latitude: 40.4998,
            longitude: -88.9903,
            createdAt: 1,
          },
        ],
      }),
    );
  });
}
async function planPublic(
  page: import("@playwright/test").Page,
  start: string,
) {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  for (const [field, name] of [
    ["Start", start],
    ["Destination", "Synthetic north end"],
  ]) {
    await page
      .getByRole("button", { name: new RegExp("^" + field + ":") })
      .click();
    await page.getByRole("textbox", { name: "Search places" }).fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(name) })
      .click();
  }
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".review-banner, .test-mode-banner, .access-connections"),
  ).toHaveCount(0);
  await expect(page.locator(".leaflet-control-attribution")).toBeVisible();
}

test("public supported guidance uses fresh simulated location and shows the note only while active", async ({
  page,
}) => {
  const { simulateDevice, fix } = await import("../webkit/support");
  await simulateDevice(page);
  await approvedPublicFixture(page);
  await planPublic(page, "Synthetic west end");
  const note = page
    .getByRole("note")
    .filter({ hasText: "Navigation is in beta and may experience issues." });
  await expect(note).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(page.locator(".ride-guidance h2")).toHaveText(
    "Reacquiring location…",
  );
  await expect(note).toHaveCount(0);
  await fix(page, 40.5, -88.99);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await expect(note).toBeVisible();
  await expect(page.getByText(/^PRIVATE TEST MODE/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(note).toHaveCount(0);
});

test("public estimated gaps keep planning and saving but block Start and a carried private ride", async ({
  page,
}) => {
  await approvedPublicFixture(page);
  await planPublic(page, "Synthetic off-trail start");
  const start = page.getByRole("button", {
    name: "Start navigation",
    exact: true,
  });
  await expect(start).toBeDisabled();
  await expect(
    page.getByText(/Can't start: .*estimated connection/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const record = await page.evaluate(() => {
    const library = JSON.parse(
      localStorage.getItem("trail-mapper.county:trail-mapper.web.library.v1")!,
    );
    if (library.saved.length !== 1) throw Error("Estimated plan was not saved");
    return library.saved[0];
  });
  // The old private override could have left an active ride in this same browser. Reinspection must refuse it.
  await page.evaluate(
    (record) =>
      localStorage.setItem(
        "trail-mapper.county:trail-mapper.web.active-ride.v1",
        JSON.stringify({
          version: 1,
          record,
          routeProgressMeters: 0,
          creditedDistanceMeters: 0,
          riddenMeters: 0,
          updatedAt: Date.now(),
        }),
      ),
    record,
  );
  await page.reload();
  await expect(
    page.getByText(
      "Your previous ride needs review before navigation can resume.",
    ),
  ).toBeVisible();
  await expect(page.locator(".guidance.navigating")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop navigation", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            "trail-mapper.county:trail-mapper.web.library.v1",
          )!,
        ).saved.length,
    ),
  ).toBe(1);
});
