import { test, expect, type Page, type Response } from "@playwright/test";
import { createHash } from "node:crypto";

// Smoke tests against the BUILT artifact served with the production header set. Basemap tiles are never
// requested: the optional basemap is off by default and the tile origin is asserted absent.

// A county artifact has different places and provenance; its own checks are in county-smoke.spec.ts.
const county = process.env.TRAIL_EXPECT_DATASET === "county";
// County graph initialization includes the real access base and can exceed the
// fixture's five-second budget. Match the existing county smoke readiness limit;
// still wait on actual planner/error UI and retain every header/asset assertion.
const bootTimeout = county ? 30_000 : 5_000;
async function collect(page: Page) {
  const responses: Response[] = [];
  const consoleErrors: string[] = [];
  const requestedOrigins = new Set<string>();
  page.on("response", (response) => responses.push(response));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) =>
    requestedOrigins.add(new URL(request.url()).origin),
  );
  return { responses, consoleErrors, requestedOrigins };
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
async function planRoute(page: Page) {
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
}

test("a fresh load serves the app with the production headers and no failing or foreign requests", async ({
  page,
  baseURL,
}) => {
  const seen = await collect(page);
  const document = await page.goto("/");
  await expect(page.getByRole("button", { name: /Go somewhere/ })).toBeVisible({
    timeout: bootTimeout,
  });
  if (county) {
    await expect(page.locator(".review-banner")).toHaveCount(0);
  } else {
    await expect(
      page.getByText(/Synthetic review network/).first(),
    ).toBeVisible();
  }
  const headers = document!.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("geolocation=(self)");
  expect(headers["cache-control"]).toBe("no-cache");
  // Every request stayed on our origin (no tiles, analytics or fonts), and every one succeeded.
  const own = new URL(baseURL!).origin;
  expect([...seen.requestedOrigins].filter((origin) => origin !== own)).toEqual(
    [],
  );
  expect(
    seen.responses
      .filter((r) => r.status() >= 400)
      .map((r) => `${r.status()} ${r.url()}`),
  ).toEqual([]);
  expect(seen.consoleErrors).toEqual([]);
  expect(
    seen.responses.some((r) => r.url().includes("/local-review-data")),
  ).toBe(false);
});
test("bundled assets are hashed, immutable and served with correct module types", async ({
  page,
}) => {
  const seen = await collect(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Go somewhere/ })).toBeVisible({
    timeout: bootTimeout,
  });
  const assets = seen.responses.filter((r) =>
    new URL(r.url()).pathname.startsWith("/assets/"),
  );
  expect(assets.length).toBeGreaterThan(1);
  for (const asset of assets) {
    expect(asset.headers()["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    if (asset.url().endsWith(".js"))
      expect(asset.headers()["content-type"]).toContain("text/javascript");
  }
  // The routing worker is delivered from the same origin as a hashed module asset.
  expect(assets.some((r) => /worker-/.test(new URL(r.url()).pathname))).toBe(
    true,
  );
});
test("the routing worker starts and plans a route, and a reload works", async ({
  page,
}) => {
  test.skip(county, "plans between synthetic review places");
  const seen = await collect(page);
  await page.goto("/");
  await planRoute(page);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  expect(
    seen.consoleErrors.filter((text) =>
      /Content Security Policy|CSP/i.test(text),
    ),
  ).toEqual([]);
  expect(
    seen.responses.filter((r) => r.status() >= 400).map((r) => r.url()),
  ).toEqual([]);
  expect(
    [...seen.requestedOrigins].some((origin) =>
      origin.includes("openstreetmap"),
    ),
  ).toBe(false);
});
test("the built ride camera loads under CSP and keeps optional street tiles off", async ({
  page,
}) => {
  test.skip(county, "plans between synthetic review places");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(success: PositionCallback) {
          (window as any).__rideFix = () =>
            success({
              coords: {
                latitude: 40.505,
                longitude: -88.95,
                accuracy: 5,
                heading: 0,
                speed: 4,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
          return 1;
        },
        clearWatch() {},
      },
    });
  });
  const seen = await collect(page);
  await page.goto("/");
  await planRoute(page);
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(page.locator(".ride-map, .ride-map-fallback")).toBeVisible();
  await expect(page.locator(".ride-map-canvas")).toBeVisible();
  await page.evaluate(() => (window as any).__rideFix());
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-actual-pitch",
    "48",
  );
  expect(
    seen.consoleErrors.filter((message) =>
      /CSP|Content Security Policy|Worker failed/i.test(message),
    ),
  ).toEqual([]);
  expect(
    [...seen.requestedOrigins].some((origin) =>
      origin.includes("openstreetmap"),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Stop navigation" }).click();
  await expect(page.locator(".ride-map-canvas")).toHaveCount(0);
});
test("a blocked worker asset gives a recoverable error and Retry recovers", async ({
  page,
}) => {
  let block = true;
  await page.route(/\/assets\/worker-.*\.js$/, (route) =>
    block ? route.abort() : route.continue(),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Trails could not load" }),
  ).toBeVisible({ timeout: bootTimeout });
  block = false;
  await page.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.getByRole("button", { name: /Go somewhere/ })).toBeVisible({
    timeout: bootTimeout,
  });
});
test("an unknown asset is a real 404 while an unknown page falls back to the app shell", async ({
  page,
  request,
}) => {
  const missing = await request.get("/assets/does-not-exist.js");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).not.toContain("text/html");
  const shell = await request.get("/some/deep/link", {
    headers: { accept: "text/html" },
  });
  expect(shell.status()).toBe(200);
  expect(await shell.text()).toContain('<div id="root">');
  await page.goto("/some/deep/link");
  await expect(page.getByRole("button", { name: /Go somewhere/ })).toBeVisible({
    timeout: bootTimeout,
  });
});
test("provenance identifies this artifact and states it is fixture-only and not publishable", async ({
  request,
}) => {
  test.skip(county, "fixture provenance; see county-smoke.spec.ts");
  const response = await request.get("/provenance.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-cache");
  const provenance = await response.json();
  expect(provenance.artifact).toBe("trail-mapper-web");
  expect(provenance.source.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(provenance.core.inputsSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(provenance.dataset.kind).toBe("fixture");
  expect(provenance.dataset.approved).toBe(false);
  expect(provenance.publicRelease.allowed).toBe(false);
  expect(provenance.publicRelease.blockers.join(" ")).toMatch(/fixture/);
  // The recorded hash of index.html is the file that was actually served.
  const indexEntry = provenance.files.find(
    (file: { path: string }) => file.path === "index.html",
  );
  const served = Buffer.from(await (await request.get("/index.html")).body());
  expect(createHash("sha256").update(served).digest("hex")).toBe(
    indexEntry.sha256,
  );
});
