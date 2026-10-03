import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

// Saved routes and Recalculate against the REAL Kotlin core: the packaged-dataset production path on SYNTHETIC data that
// reuses the actual Willow source leg 97 -> 98 (so the real closure gate is what refuses and what recalculates). The page
// clock is moved, and the app passes its own Date.now() to the worker with every request, so the closure is genuinely
// in force. These are gating checks, not rendering fixtures: only the network is synthetic.
const LIBRARY_KEY = "trail-mapper.county:trail-mapper.web.library.v1";
const SESSION_KEY = "trail-mapper.county:trail-mapper.web.session.v1";
const BEFORE = new Date("2026-10-04T12:00:00Z");
const AFTER = new Date("2026-10-05T11:30:00Z");
const V97 = { latitude: 40.5096012799, longitude: -88.9843690241 };
const V98 = { latitude: 40.516684074, longitude: -88.9849653323 };
const EAST = 0.0036;

const places = [
  ["south", "Willow south end", V97],
  ["north", "Willow north end", V98],
].map(([key, label, at]: any) => ({
  key,
  label,
  latitude: at.latitude,
  longitude: at.longitude,
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
type Network = { layers: Array<{ features: any[] }> };
/** Serves a network of the Willow source leg, with or without a trail that goes around it. */
async function serveWillow(page: Page, { detour }: { detour: boolean }) {
  const record = await (await page.request.get("/data/dataset.json")).json();
  const network: Network = await (
    await page.request.get(`/data/${record.content.file}`)
  ).json();
  const template = network.layers[0].features[0];
  const trail = (
    id: string,
    points: { latitude: number; longitude: number }[],
  ) => ({
    ...structuredClone(template),
    id,
    paths: [points.map((p) => [p.longitude, p.latitude])],
  });
  network.layers[0].features = [
    trail("54:1305", [V97, V98]),
    ...(detour
      ? [
          trail("54:9300", [
            V97,
            { latitude: V97.latitude, longitude: V97.longitude + EAST },
            { latitude: V98.latitude, longitude: V98.longitude + EAST },
            V98,
          ]),
        ]
      : []),
  ];
  const body = Buffer.from(JSON.stringify(network));
  const sha = createHash("sha256").update(body).digest("hex");
  const file = `trails.${sha.slice(0, 12)}.json`;
  const changed = {
    ...record,
    version: `willow.${sha.slice(0, 12)}`,
    content: {
      ...record.content,
      file,
      sha256: sha,
      bytes: body.length,
      featureCount: network.layers.flatMap((l) => l.features).length,
    },
  };
  await page.route("**/data/dataset.json", (route) =>
    route.fulfill({ json: changed }),
  );
  await page.route(`**/data/${file}`, (route) =>
    route.fulfill({ body, contentType: "application/json" }),
  );
}
const library = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), LIBRARY_KEY);
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
const start = (page: Page) =>
  page.getByRole("button", { name: "Start navigation", exact: true });
/** Plans south end -> north end while the closure is still only scheduled, and saves it. */
async function planAndSave(page: Page, { detour }: { detour: boolean }) {
  await seedPlaces(page);
  await serveWillow(page, { detour });
  await page.clock.install({ time: BEFORE });
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Willow south end");
  await choose(page, "Destination", "Willow north end");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(start(page)).toBeEnabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved to Saved routes")).toBeVisible();
}
/** Opens the saved route after the closure has begun, through the Saved list (the route is re-checked on opening). */
async function openSavedAfterActivation(
  page: Page,
  title = /^Willow south end to Willow north end Point-to-point/,
) {
  await page.clock.setSystemTime(AFTER);
  // The previous screen is cleared once (not on every later reload, which is the restore path under test).
  await page.addInitScript((key) => {
    if (sessionStorage.getItem("__cleared")) return;
    sessionStorage.setItem("__cleared", "1");
    localStorage.removeItem(key);
  }, SESSION_KEY);
  await page.goto("/");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByRole("button", { name: title }).first().click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
}

test("a saved route opened after the closure began shows the current warning, keeps Start off, and is not touched", async ({
  page,
}) => {
  await planAndSave(page, { detour: true });
  const before = await library(page);
  expect(before.saved).toHaveLength(1);
  await openSavedAfterActivation(page);
  await expect(page.locator(".closure-list")).toContainText(
    "Willow Street trail closure advisory",
  );
  await expect(start(page)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Recalculate around the closure" }),
  ).toBeVisible();
  // The exact record is unchanged (opening may move its use time only).
  const after = await library(page);
  expect(after.saved).toHaveLength(1);
  const { usedAt: _a, ...kept } = after.saved[0];
  const { usedAt: _b, ...original } = before.saved[0];
  expect(kept).toEqual(original);
});

test("Recalculate makes a temporary, freshly checked route that Start accepts, and writes nothing to the library", async ({
  page,
}) => {
  await planAndSave(page, { detour: true });
  const before = await library(page);
  await openSavedAfterActivation(page);
  const afterOpen = await library(page);
  await page
    .getByRole("button", { name: "Recalculate around the closure" })
    .click();
  await expect(page.locator(".recalculated-route")).toContainText(
    "Recalculated route · not saved",
  );
  await expect(page.locator(".recalculated-route")).toContainText(
    "Your saved route is unchanged",
  );
  // Gated by the real core: the closed travel is gone, the closure no longer applies, and Start is accepted.
  await expect(page.locator(".closure-list")).toHaveCount(0);
  await expect(start(page)).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Save as new route" }),
  ).toBeVisible();
  // Nothing was written: not the original, not Recent, not the result.
  expect(await library(page)).toEqual(afterOpen);
  expect((await library(page)).saved[0].route).toEqual(before.saved[0].route);
  expect((await library(page)).recent).toEqual(afterOpen.recent);
  // The temporary status survives a reload, still without any library write.
  await page.reload();
  await expect(page.locator(".recalculated-route")).toContainText("not saved");
  await expect(start(page)).toBeEnabled();
  expect(await library(page)).toEqual(afterOpen);
});

test("Save as new route keeps the original, survives a reload, and an identical-geometry or already-saved route is never overwritten", async ({
  page,
}) => {
  await planAndSave(page, { detour: true });
  await openSavedAfterActivation(page);
  const originalKey = (await library(page)).saved[0].key;
  // A route with exactly the geometry the recalculation will produce is already saved: plan it now, around the closure.
  await page.getByRole("button", { name: "← Back" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Plan", exact: true })
    .click();
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Willow south end");
  await choose(page, "Destination", "Willow north end");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(start(page)).toBeEnabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved to Saved routes")).toBeVisible();
  const withSameGeometry = await library(page);
  expect(withSameGeometry.saved).toHaveLength(2);
  const sameGeometryKey = withSameGeometry.saved.find(
    (item: any) => item.key !== originalKey,
  ).key;
  // Now recalculate the original: same geometry as that saved route, but its own minted identity.
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  // Both saved routes have that title; the original is the older one (the list is newest first).
  await page
    .getByRole("button", {
      name: /^Willow south end to Willow north end Point-to-point/,
    })
    .last()
    .click();
  await page.getByRole("button", { name: "Recalculate route" }).click();
  await expect(page.locator(".recalculated-route")).toBeVisible();
  await page.getByRole("button", { name: "Save as new route" }).click();
  await expect(page.getByText(/Saved as a new route/)).toBeVisible();
  const saved = (await library(page)).saved;
  expect(saved).toHaveLength(3);
  const keys = saved.map((item: any) => item.key);
  expect(new Set(keys).size).toBe(3);
  expect(keys).toContain(originalKey);
  expect(keys).toContain(sameGeometryKey);
  const added = saved.find((item: any) =>
    item.title.endsWith("(recalculated)"),
  );
  expect(added.temporary).toBeUndefined();
  expect(added.recalculatedFrom.key).toBeDefined();
  // The route that was already saved with that geometry is exactly as it was.
  expect(saved.find((item: any) => item.key === sameGeometryKey)).toEqual(
    withSameGeometry.saved.find((item: any) => item.key === sameGeometryKey),
  );
  // The banner is gone (the route is saved) and everything survives a reload.
  await expect(page.locator(".recalculated-route")).toHaveCount(0);
  await page.reload();
  expect(
    (await library(page)).saved.map((item: any) => item.key).sort(),
  ).toEqual([...keys].sort());
});

test("when no route avoids the closure the result is explained, the original is kept, and Start stays off", async ({
  page,
}) => {
  await planAndSave(page, { detour: false });
  await openSavedAfterActivation(page);
  const before = await library(page);
  await page
    .getByRole("button", { name: "Recalculate around the closure" })
    .click();
  await expect(page.locator(".error").first()).toContainText(
    "No safe route avoids the active trail closure",
  );
  await expect(page.locator(".error").first()).toContainText(
    "Your saved route is unchanged",
  );
  await expect(page.locator(".recalculated-route")).toHaveCount(0);
  await expect(start(page)).toBeDisabled();
  await expect(page.locator(".closure-list")).toContainText(
    "Willow Street trail closure advisory",
  );
  expect(await library(page)).toEqual(before);
});

test("a storage failure on Save as new route says so, announces no success, and leaves the original and the temporary route alone", async ({
  page,
}) => {
  await planAndSave(page, { detour: true });
  await openSavedAfterActivation(page);
  const before = await library(page);
  await page
    .getByRole("button", { name: "Recalculate around the closure" })
    .click();
  await expect(page.locator(".recalculated-route")).toBeVisible();
  await page.evaluate((key) => {
    const real = Storage.prototype.setItem;
    (window as any).__setItem = real;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key)
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      return real.call(this, name, value);
    };
  }, LIBRARY_KEY);
  await page.getByRole("button", { name: "Save as new route" }).click();
  await expect(page.getByText(/Saved as a new route/)).toHaveCount(0);
  await expect(
    page.getByText(/no room|full|could not be saved/i).first(),
  ).toBeVisible();
  await expect(page.locator(".recalculated-route")).toContainText("not saved");
  await page.evaluate(() => {
    Storage.prototype.setItem = (window as any).__setItem;
  });
  expect(await library(page)).toEqual(before);
  // Once the failure is cleared the same route saves, as a new record.
  await page.getByRole("button", { name: "Save as new route" }).click();
  await expect(page.getByText(/Saved as a new route/)).toBeVisible();
  expect((await library(page)).saved).toHaveLength(2);
});
