import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

// Everything here runs against SYNTHETIC data packaged and served exactly like the county candidate would be.
// Failures and data changes are injected by intercepting the two data requests, so the real loader, hash checks and
// current-network revalidation are what is being exercised.
const LIBRARY_KEY = "trail-mapper.county:trail-mapper.web.library.v1";
const ACTIVE_KEY = "trail-mapper.county:trail-mapper.web.active-ride.v1";
const FIXTURE_KEYS = /trail-mapper\.fixture:/;

const places = [
  ["west", "Synthetic west end", 40.5, -88.99],
  ["north", "Synthetic north end", 40.52, -88.97],
  ["east", "Synthetic east corner", 40.52, -88.95],
  ["detached", "Synthetic detached trail", 40.55, -88.9],
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
async function planWestToNorth(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Synthetic west end");
  await choose(page, "Destination", "Synthetic north end");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
}

type Network = {
  layers: Array<{
    features: Array<{
      id: string;
      status: string;
      routeRoles: string[];
      paths: number[][][];
    }>;
  }>;
};
/** Serves a different network under a record whose hash, size and count are correct for it. */
async function serveNetwork(page: Page, change: (network: Network) => void) {
  const record = await (await page.request.get("/data/dataset.json")).json();
  const network: Network = await (
    await page.request.get(`/data/${record.content.file}`)
  ).json();
  change(network);
  const body = Buffer.from(JSON.stringify(network));
  const sha = createHash("sha256").update(body).digest("hex");
  const file = `trails.${sha.slice(0, 12)}.json`;
  const changed = {
    ...record,
    version: `changed.${sha.slice(0, 12)}`,
    content: {
      ...record.content,
      file,
      sha256: sha,
      bytes: body.length,
      featureCount: network.layers.flatMap((layer) => layer.features).length,
    },
  };
  await page.route("**/data/dataset.json", (route) =>
    route.fulfill({ json: changed }),
  );
  await page.route(`**/data/${file}`, (route) =>
    route.fulfill({ body, contentType: "application/json" }),
  );
}
const feature = (network: Network, id: string) =>
  network.layers.flatMap((layer) => layer.features).find((f) => f.id === id)!;

/**
 * Opens a route from the Recent list. With `restored`, the browser is reloaded on the preview instead, which is the
 * session-restore path; both must re-check the route against the data loaded now.
 */
async function openRecent(
  page: Page,
  title: RegExp,
  { restored = false }: { restored?: boolean } = {},
) {
  // The app rewrites the session as the page unloads, so the previous screen is cleared as the next page starts.
  if (!restored)
    await page.addInitScript(() =>
      localStorage.removeItem(
        "trail-mapper.county:trail-mapper.web.session.v1",
      ),
    );
  await page.goto("/");
  const preview = page.getByRole("heading", {
    name: "Route preview",
    exact: true,
  });
  if (!restored) {
    await page.getByRole("button", { name: "Saved", exact: true }).click();
    await page.getByRole("tab", { name: /^Recent/ }).click();
    await page.getByRole("button", { name: title }).first().click();
  }
  await expect(preview).toBeVisible();
}

test("the county build loads its packaged data and says what it is, with no fixture in sight", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await seedPlaces(page);
  await page.goto("/");
  await expect(page.locator(".review-banner")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await expect(page.getByRole("dialog")).not.toContainText("Review trailhead");
  await page.getByRole("button", { name: "Close Choose start" }).click();
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  const virginiaRoadNotice = page.locator(".updates-list article").filter({
    has: page.getByRole("heading", {
      name: "Virginia Avenue road access: Linden to Broadway",
    }),
  });
  await expect(virginiaRoadNotice).toContainText("local traffic only");
  await expect(virginiaRoadNotice).toContainText(
    "does not establish that the trail is closed or reopened",
  );
  await expect(
    virginiaRoadNotice.getByRole("link", {
      name: "Normal Virginia Avenue road notice",
    }),
  ).toHaveAttribute(
    "href",
    "https://www.normalil.gov/m/newsflash/Home/Detail/3360",
  );
  const data = page.getByRole("region", { name: "Trail data" });
  await expect(data).toContainText("CC BY 4.0");
  await expect(data).toContainText("Changes made:");
  await expect(data).toContainText("Feature set reviewed on 2026-01-01");
  await expect(data).toContainText("Extracted 2026-01-02");
  await expect(data).toContainText("not approved for public release");
  await expect(data.getByRole("link", { name: /CC BY 4.0/ })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by/4.0/",
  );
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.some((key) => FIXTURE_KEYS.test(key))).toBe(false);
  expect(failures).toEqual([]);
});

test("a route planned on the packaged data is saved with its data identity and is current on reopening", async ({
  page,
}) => {
  await seedPlaces(page);
  await planWestToNorth(page);
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    LIBRARY_KEY,
  );
  expect(stored.recent[0].dataset).toMatchObject({
    kind: "county",
    id: "synthetic-county",
  });
  expect(stored.recent[0].dataset.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  await openRecent(page, /Synthetic west end to Synthetic north end/);
  await expect(page.getByText("needs recalculating")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
});

const changes: Array<[string, (network: Network) => void, RegExp]> = [
  [
    "a trail that is no longer in the data",
    (n) => {
      for (const layer of n.layers)
        layer.features = layer.features.filter((f) => f.id !== "54:9001");
    },
    /no longer in the data/,
  ],
  [
    "an existing trail that is now proposed",
    (n) => {
      feature(n, "54:9001").status = "Proposed";
    },
    /is now proposed/,
  ],
  [
    "a trail that moved",
    (n) => {
      feature(n, "54:9001").paths = [
        [
          [-88.99, 40.5],
          [-88.98, 40.501],
          [-88.97, 40.5],
        ],
      ];
    },
    /different geometry/,
  ],
  [
    "a trail that is no longer usable for the route's choices",
    (n) => {
      feature(n, "54:9001").routeRoles = ["ProposedTrails"];
    },
    /not available under this route's choices/,
  ],
];
for (const [name, change, expected] of changes)
  test(`a saved route over ${name} is kept, explained, and cannot be started until recalculated`, async ({
    page,
  }) => {
    await seedPlaces(page);
    await planWestToNorth(page);
    await serveNetwork(page, change);
    await openRecent(page, /Synthetic west end to Synthetic north end/, {
      restored: name.includes("moved"),
    });
    const alert = page.locator(".stale-route");
    await expect(alert).toContainText("This route needs recalculating");
    await expect(alert).toContainText("The trail data has changed");
    await expect(alert).toContainText(expected);
    await expect(
      page.getByRole("button", { name: "Start navigation", exact: true }),
    ).toBeDisabled();
    // Preserved: still in the library, with the geometry it had.
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      LIBRARY_KEY,
    );
    expect(stored.recent).toHaveLength(1);
    expect(stored.recent[0].route.segments.length).toBeGreaterThan(0);
  });

test("recalculating a stale route plans on the current data and re-enables navigation, or says there is no route", async ({
  page,
}) => {
  await seedPlaces(page);
  await planWestToNorth(page);
  // Moving one trail still leaves a connected network, so the recalculated route exists.
  await serveNetwork(page, (n) => {
    feature(n, "54:9001").paths = [
      [
        [-88.99, 40.5],
        [-88.98, 40.4995],
        [-88.97, 40.5],
      ],
    ];
  });
  await openRecent(page, /Synthetic west end to Synthetic north end/, {
    restored: true,
  });
  await expect(page.locator(".stale-route")).toBeVisible();
  await page
    .getByRole("button", { name: "Recalculate on current data" })
    .click();
  await expect(page.getByText(/Recalculated route ready/)).toBeVisible();
  await expect(page.locator(".stale-route")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
});

test("a legacy saved route with no trail identities is preserved but cannot be checked or ridden", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) => {
      if (localStorage.getItem(key)) return;
      const a = { latitude: 40.5, longitude: -88.99 },
        b = { latitude: 40.5, longitude: -88.97 };
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          saved: [],
          places: [],
          recent: [
            {
              key: "legacy",
              title: "Legacy route",
              createdAt: Date.now(),
              usedAt: Date.now(),
              route: {
                segments: [{ type: "Trail", points: [a, b], isRouted: true }],
                totalDistanceMeters: 1700,
                ordinaryAccessDistanceMeters: 0,
                totalCost: 1,
                kind: "Navigation",
              },
              draft: {
                mode: "point",
                start: { label: "A", ...a },
                destination: { label: "B", ...b },
                miles: 5,
                proposed: false,
              },
            },
          ],
        }),
      );
    },
    { key: LIBRARY_KEY },
  );
  await openRecent(page, /Legacy route/);
  await expect(page.locator(".stale-route")).toContainText(
    "cannot be checked against the current trail data",
  );
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeDisabled();
});

test("a restored ride over changed data is not resumed and explains why", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key }) => {
      if (localStorage.getItem(key)) return;
      const a = { latitude: 40.5, longitude: -88.99 },
        b = { latitude: 40.5, longitude: -88.97 };
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          record: {
            key: "ride",
            title: "Ride in progress",
            createdAt: 1,
            usedAt: 1,
            route: {
              segments: [{ type: "Trail", points: [a, b], isRouted: true }],
              totalDistanceMeters: 1700,
              ordinaryAccessDistanceMeters: 0,
              totalCost: 1,
              kind: "Navigation",
            },
            draft: {
              mode: "point",
              start: { label: "A", ...a },
              destination: { label: "B", ...b },
              miles: 5,
              proposed: false,
            },
          },
          routeProgressMeters: 300,
          creditedDistanceMeters: 300,
          updatedAt: Date.now(),
        }),
      );
    },
    { key: ACTIVE_KEY },
  );
  await page.goto("/");
  await expect(page.getByText("was not resumed")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".guidance.navigating")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeDisabled();
});

async function expectLoadFailure(page: Page, text: RegExp) {
  await page.goto("/");
  const alert = page.getByRole("alert").filter({ hasText: "could not load" });
  await expect(alert).toContainText(text);
  await expect(alert).toContainText("Nothing else is shown");
  // No fixture, no places, no map trails: the failure is the whole story.
  await expect(page.locator(".review-banner")).not.toContainText("Synthetic");
  await expect(page.getByText("Review trailhead")).toHaveCount(0);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.some((key) => FIXTURE_KEYS.test(key))).toBe(false);
  return alert;
}

test("missing data fails visibly, survives a reload without falling back, and Retry recovers when it returns", async ({
  page,
}) => {
  let available = false;
  await page.route("**/data/dataset.json", (route) =>
    available ? route.continue() : route.fulfill({ status: 404 }),
  );
  const alert = await expectLoadFailure(page, /missing from this site/);
  await page.reload();
  await expectLoadFailure(page, /missing from this site/);
  available = true;
  await alert.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.locator(".review-banner")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("altered data is refused as corrupt, and so is a description this app cannot read", async ({
  page,
}) => {
  const record = await (await page.request.get("/data/dataset.json")).json();
  const body = Buffer.from(
    await (await page.request.get(`/data/${record.content.file}`)).body(),
  );
  const altered = Buffer.from(body);
  altered[altered.length - 5] ^= 1;
  let mode: "altered" | "incompatible" | "ok" = "altered";
  await page.route("**/data/dataset.json", (route) =>
    mode === "incompatible"
      ? route.fulfill({ json: { ...record, schema: "trail-mapper.dataset/2" } })
      : route.continue(),
  );
  await page.route(`**/data/${record.content.file}`, (route) =>
    mode === "altered"
      ? route.fulfill({ body: altered, contentType: "application/json" })
      : route.continue(),
  );
  const alert = await expectLoadFailure(page, /checksum|damaged|not valid/);
  mode = "incompatible";
  await alert.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "different version of the app",
  );
  mode = "ok";
  await page.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.locator(".review-banner")).toHaveCount(0);
});

test("a routing worker that dies and restarts reloads the same packaged data, never the fixture", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    (window as any).__workers = [];
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as any).__workers.push(this);
      }
    } as typeof Worker;
  });
  await seedPlaces(page);
  await planWestToNorth(page);
  await page.evaluate(() =>
    ((window as any).__workers as Worker[])
      .at(-1)!
      .dispatchEvent(new ErrorEvent("error")),
  );
  await page.getByRole("button", { name: "Restart route planning" }).click();
  await expect(page.getByText("Route planning restarted")).toBeVisible();
  await page.getByRole("button", { name: "Recalculate route" }).click();
  await expect(page.getByText(/Recalculated route ready/)).toBeVisible();
  await expect(page.locator(".review-banner")).toHaveCount(0);
  await expect(page.getByText("Review trailhead")).toHaveCount(0);
});

test("an exported route names the data, its license and the changes made to it", async ({
  page,
}) => {
  await seedPlaces(page);
  await planWestToNorth(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download/ }).click();
  const file = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile((await (await downloaded).path())!, "utf8"),
  );
  expect(file.routeContext.dataset).toMatchObject({
    mode: "county",
    id: "synthetic-county",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    reviewedOn: "2026-01-01",
    approved: false,
  });
  expect(file.routeContext.dataset.changes).toMatch(/Reviewed subset/);
  expect(JSON.stringify(file)).toContain("Synthetic county");
});

test("a destination on a trail that connects to nothing is never joined up: no route, and no invented connection", async ({
  page,
}) => {
  await seedPlaces(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Synthetic west end");
  await choose(page, "Destination", "Synthetic detached trail");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  const preview = page.getByRole("heading", {
    name: "Route preview",
    exact: true,
  });
  const failure = page.getByRole("alert").filter({ hasText: /No safe route/ });
  await expect(preview.or(failure)).toBeVisible();
  if (await preview.isVisible())
    // If a preview is offered at all, riding it must be impossible.
    await expect(
      page.getByRole("button", { name: "Start navigation", exact: true }),
    ).toBeDisabled();
  else await expect(failure).toContainText("available network");
});

test("an exercise loop is planned on the packaged trails and stays a loop", async ({
  page,
}) => {
  await seedPlaces(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Synthetic west end");
  await page.getByRole("button", { name: "3 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
});

test("a stale route cannot be exported as verified trail, in either privacy mode", async ({
  page,
}) => {
  await seedPlaces(page);
  await planWestToNorth(page);
  await serveNetwork(page, (n) => {
    for (const layer of n.layers)
      layer.features = layer.features.filter((f) => f.id !== "54:9001");
  });
  await openRecent(page, /Synthetic west end to Synthetic north end/, {
    restored: true,
  });
  await expect(page.locator(".stale-route")).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  let downloads = 0;
  page.on("download", () => downloads++);
  for (const exact of [false, true]) {
    const box = dialog.getByRole("checkbox", {
      name: /Include exact start and destination/,
    });
    if (exact) await box.check();
    await dialog.getByRole("button", { name: /Download/ }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "cannot be exported as verified trail",
    );
    await expect(dialog.getByRole("alert")).toContainText(
      "no longer in the data",
    );
  }
  expect(downloads).toBe(0);
});

test("an export names both the data the route was planned on and the data it was checked against", async ({
  page,
}) => {
  await seedPlaces(page);
  await planWestToNorth(page);
  // A different, still compatible network: the route stays valid but the data identity differs.
  await serveNetwork(page, (n) => {
    feature(n, "16:9005").routeRoles = ["ParkConnectors"];
    feature(n, "16:9005").paths = [
      [
        [-88.9, 40.551],
        [-88.88, 40.551],
      ],
    ];
  });
  await openRecent(page, /Synthetic west end to Synthetic north end/, {
    restored: true,
  });
  await expect(page.locator(".stale-route")).toHaveCount(0);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download/ }).click();
  const file = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile((await (await downloaded).path())!, "utf8"),
  );
  const dataset = file.routeContext.dataset;
  expect(dataset.routeCheck).toBe("current");
  expect(dataset.version).toMatch(/^changed\./);
  expect(dataset.plannedOn.version).toMatch(/^2026-01-01\./);
  expect(dataset.plannedOn.contentSha256).not.toBe(dataset.contentSha256);
});

test("recovery and restarts keep routing, saving and showing the exact data the page started with", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    (window as any).__workers = [];
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as any).__workers.push(this);
      }
    } as typeof Worker;
  });
  await seedPlaces(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Synthetic west end");
  await choose(page, "Destination", "Synthetic north end");
  const original = await (await page.request.get("/data/dataset.json")).json();
  // The site publishes new data while this page is open.
  await serveNetwork(page, (n) => {
    feature(n, "54:9002").paths = [
      [
        [-88.97, 40.5],
        [-88.97, 40.53],
      ],
    ];
  });
  await page.evaluate(() =>
    ((window as any).__workers as Worker[])
      .at(-1)!
      .dispatchEvent(new ErrorEvent("error")),
  );
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await page.getByRole("button", { name: "Restart route planning" }).click();
  await expect(page.getByText("Route planning restarted")).toBeVisible();
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    LIBRARY_KEY,
  );
  // The route was made on the original data and is recorded as such, not against what the site serves now.
  expect(stored.recent[0].dataset.contentSha256).toBe(original.content.sha256);
  expect(stored.recent[0].dataset.version).toBe(original.version);
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  await expect(page.getByRole("region", { name: "Trail data" })).toContainText(
    original.version,
  );
});

test("when the data a page started with is no longer served, a restart says so and asks for a reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    (window as any).__workers = [];
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        (window as any).__workers.push(this);
      }
    } as typeof Worker;
  });
  await seedPlaces(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  const original = await (await page.request.get("/data/dataset.json")).json();
  await page.route(`**/data/${original.content.file}`, (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.evaluate(() =>
    ((window as any).__workers as Worker[])
      .at(-1)!
      .dispatchEvent(new ErrorEvent("error")),
  );
  await page.getByRole("button", { name: "Restart route planning" }).click();
  await expect(page.getByRole("alert").last()).toContainText(
    "reload the page to use the current data",
  );
});

test("a description with damaged omission details is refused at load, with Retry, instead of blanking Explore", async ({
  page,
}) => {
  const record = await (await page.request.get("/data/dataset.json")).json();
  let damaged = true;
  await page.route("**/data/dataset.json", (route) =>
    damaged
      ? route.fulfill({ json: { ...record, omitted: {} } })
      : route.continue(),
  );
  const alert = await expectLoadFailure(
    page,
    /does not say what it leaves out/,
  );
  damaged = false;
  await alert.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.locator(".review-banner")).toHaveCount(0);
});

test("Help describes the packaged county data it is running on: coverage, license, changes, identity and review status", async ({
  page,
}) => {
  await seedPlaces(page);
  await page.goto("/");
  await expect(page.locator(".review-banner")).toHaveCount(0);
  await page.getByRole("button", { name: /^Help/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Help and about" });
  await expect(dialog).toContainText(
    "Bloomington–Normal and nearby McLean County",
  );
  await expect(dialog).toContainText("5 existing trail features (about");
  await expect(dialog).toContainText("This build has no street-access data");
  await expect(dialog).not.toContainText("Do not ride it");
  // Source, license and change notices, with the license as a real link.
  await expect(dialog.getByRole("link", { name: /CC BY 4.0/ })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by/4.0/",
  );
  await expect(dialog).toContainText("Changes made:");
  await expect(dialog).toContainText("Feature set reviewed on 2026-01-01");
  await expect(dialog).toContainText("not approved for public release");
  // Dataset and build identity: the data version and its hash prefix, and the build line.
  const record = await (await page.request.get("/data/dataset.json")).json();
  await expect(dialog).toContainText(record.version);
  await expect(dialog).toContainText(record.content.sha256.slice(0, 12));
  await expect(dialog).toContainText("county data build");
  // The optional basemap exists in this build, so the privacy copy does not say it is unavailable.
  await expect(dialog).not.toContainText(
    "not offered in the synthetic review build",
  );
  await expect(dialog).toContainText("Street basemap (online)");
});

test("Help on the build WITHOUT road data says so, claims no road files, and the session requested none", async ({
  page,
}) => {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  // The optional basemap host is stubbed: nothing may reach it, and the build never asks.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await seedPlaces(page);
  await page.goto("/");
  await expect(page.locator(".review-banner")).toHaveCount(0);
  await page.getByRole("button", { name: /^Help/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Help and about" });
  await expect(dialog).toContainText(
    "This build has no street-access data: the app routes only on the loaded features",
  );
  await expect(dialog).toContainText(
    "Outside the loaded features there is nothing to route on",
  );
  await expect(dialog).toContainText(
    "The app never uploads your exact GPS fixes, what you type or what you save",
  );
  const copy = await dialog.innerText();
  expect(copy).not.toContain("road files");
  expect(copy).not.toContain("map squares");
  expect(copy).not.toContain("is not sent by the app anywhere");
  expect(copy).not.toContain("Road access:");
  // The packaged record carries no road data, which is what the copy was derived from.
  const record = await (await page.request.get("/data/dataset.json")).json();
  expect(record.access).toBeUndefined();
  expect(urls.filter((url) => /access-/.test(url))).toEqual([]);
  expect(urls.filter((url) => /tile\.openstreetmap\.org/.test(url))).toEqual(
    [],
  );
});
