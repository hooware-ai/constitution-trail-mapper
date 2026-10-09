// The county build that ALSO packages SYNTHETIC ordinary-road access as base roads plus on-demand service-road tiles
// (served on its own port by tests/support/serve-county.mjs --access; see playwright.county.config.ts). It proves, through
// the real built artifact, that opening the planner downloads no service-road tiles, that a trip downloads and verifies
// only the tiles around its endpoints, that a failed or corrupted download is reported and retried, and that Help and the
// map credit say where the road data came from.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { accessPlaces, closureTrailEntry } from "../support/access-fixture.mjs";

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
  await expect(help).toContainText(
    "service roads load only for the map squares",
  );
  await expect(
    help.getByRole("link", { name: /OpenStreetMap contributors \(ODbL\)/ }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  const details = help
    .locator("details")
    .filter({ hasText: "Routing data downloads and license details" });
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  const response = await page.request.get("/data/dataset.json");
  expect(response.ok()).toBe(true);
  const record = await response.json();
  for (const [name, file] of [
    ["Data file list and source notices", "dataset.json"],
    ["Trail geometry", record.content.file],
    ["Base road data", record.access.base.file],
    ["Service-road tile index", record.access.index.file],
  ]) {
    const link = details.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", `/data/${file}`);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect((await page.request.get(`/data/${file}`)).ok()).toBe(true);
  }
  await expect(
    details.getByRole("link", { name: /^ODbL 1\.0/ }),
  ).toHaveAttribute("href", "https://opendatacommons.org/licenses/odbl/1-0/");
  await expect(
    details.getByRole("link", { name: /^CC BY 4\.0/ }),
  ).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
  const index = await (
    await page.request.get(`/data/${record.access.index.file}`)
  ).json();
  expect(index.tiles.length).toBeGreaterThan(0);
  for (const tile of index.tiles) {
    const response = await page.request.get(`/data/${tile.file}`);
    expect(response.ok(), tile.file).toBe(true);
    const body = await response.body();
    expect(body.byteLength, tile.file).toBe(tile.bytes);
    expect(createHash("sha256").update(body).digest("hex"), tile.file).toBe(
      tile.sha256,
    );
  }
  const provenance = await (await page.request.get("/provenance.json")).json();
  const source = details.getByRole("link", {
    name: /Extraction, normalization and graph-construction/,
  });
  if (provenance.source.dirty === false) {
    await expect(source).toHaveAttribute(
      "href",
      `https://github.com/hooware-ai/constitution-trail-mapper/tree/${provenance.source.commit.slice(0, 12)}`,
    );
  } else {
    await expect(source).toHaveCount(0);
  }
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

const WILLOW_START = Date.parse("2026-10-05T11:00:00Z");

// RENDERING evidence only: the build carries a synthetic trail with the closure's feature id so the closure has geometry
// to draw. Whether a route over it may start navigation is the shared core's gate, covered with the real core (and real
// dates) in tests/unit/bridge-closures.test.ts and bridge-reverse.test.ts, not by this fixture.
test("Explore draws the reported closure with its official notice link, and its switch hides and shows it", async ({
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
  // Uptown is in force from September 21; the scheduled Willow closure joins it from its own instant (see below).
  await expect(markers).toHaveCount(Date.now() >= WILLOW_START ? 2 : 1);
  // The marker opens the closure's details with a link to the town's official notice, opened safely.
  await markers.first().click();
  const notice = page.getByRole("link", { name: "Review official notice" });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute(
    "href",
    "https://www.normalil.gov/m/newsflash/Home/Detail/3337",
  );
  await expect(notice).toHaveAttribute("target", "_blank");
  await expect(notice).toHaveAttribute("rel", /noopener/);
  await closures.uncheck();
  await expect(markers).toHaveCount(0);
  await closures.check();
  await expect(markers).toHaveCount(Date.now() >= WILLOW_START ? 2 : 1);
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

// The routing worker reads its own clock, which a page cannot move, so the closures it would report at a chosen instant
// are asked of the REAL core here and handed to the page in place of the worker's own answer to its boot. The page
// is the real built app; what is checked is how it draws and words what the core reports. The instants themselves
// (and Start, new plans and recalculation) are proved against the core in tests/unit/bridge-timed-closures.test.ts.
async function closuresAt(iso: string) {
  const corePath = join(
    resolve(process.cwd(), ".."),
    "webBridge",
    "build",
    "dist",
    "js",
    "productionLibrary",
    "TrailMapper-webBridge.mjs",
  );
  const core: any = await import(
    `${pathToFileURL(corePath).href}?county-willow=${iso}`
  );
  const trail = {
    source: {},
    layers: [
      {
        id: 54,
        name: "Synthetic",
        features: [
          {
            id: "54:1305",
            name: "Synthetic",
            status: "Existing",
            routeRoles: ["TrailBranches"],
            paths: closureTrailEntry[3],
          },
        ],
      },
    ],
  };
  const answer = JSON.parse(
    core.dispatch(
      JSON.stringify({
        op: "initialize",
        trails: JSON.stringify(trail),
        now: Date.parse(iso),
      }),
    ),
  );
  expect(answer.ok).toBe(true);
  return answer.closures;
}
async function patchInitialize(page: Page, closures: unknown) {
  await page.addInitScript((patched) => {
    const NativeWorker = window.Worker;
    class Spy extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const ops = new Map<number, string>();
        let handler: ((event: MessageEvent) => void) | null = null;
        const post = this.postMessage.bind(this);
        (this as any).postMessage = (message: any, ...rest: any[]) => {
          if (message?.request) ops.set(message.id, message.request.op);
          return (post as any)(message, ...rest);
        };
        Object.defineProperty(this, "onmessage", {
          set: (fn) => {
            handler = fn;
          },
          get: () => handler,
        });
        this.addEventListener("message", (event: MessageEvent) => {
          const deliver = (data: unknown) =>
            handler?.call(this, new MessageEvent("message", { data }));
          if (ops.get(event.data?.id) === "boot")
            return deliver({
              ...event.data,
              result: { ...event.data.result, closures: patched },
            });
          deliver(event.data);
        });
      }
    }
    (window as any).Worker = Spy;
  }, closures);
}
async function openExplore(page: Page) {
  await seedPlaces(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
}

test("the Willow closure is drawn from the core's report at its instant, with its approximation label and a safely opened official link, and not one second earlier", async ({
  page,
  browser,
}) => {
  const early = await closuresAt("2026-10-05T10:59:59Z");
  const active = await closuresAt("2026-10-05T11:00:00Z");
  expect(early.map((c: any) => c.id)).toEqual([
    "uptown-underpass-detour-2026-09-21",
  ]);
  expect(active.map((c: any) => c.id)).toEqual([
    "uptown-underpass-detour-2026-09-21",
    "willow-trail-crossing-2026-10-05",
  ]);
  // One second before: only the closure already in force is drawn.
  const earlyContext = await browser.newContext();
  const earlyPage = await earlyContext.newPage();
  await patchInitialize(earlyPage, early);
  await openExplore(earlyPage);
  await expect(earlyPage.locator(".closure-marker")).toHaveCount(1);
  await earlyContext.close();
  // At the instant: both, the second with its label, check date and official link.
  await patchInitialize(page, active);
  await openExplore(page);
  const markers = page.locator(".closure-marker");
  await expect(markers).toHaveCount(2);
  // The Willow section lies north of the first view; the click is delivered to its marker wherever it is.
  await markers.last().dispatchEvent("click");
  const note = page.getByText(/Approximate: the Town's online closure map/);
  await expect(note).toBeVisible();
  await expect(note).toContainText("Notice checked October 2, 2026");
  const links = page.getByRole("link", { name: "Review official notice" });
  await expect(links.last()).toHaveAttribute(
    "href",
    "https://www.normalil.gov/m/newsflash/home/detail/3356",
  );
  await expect(links.last()).toHaveAttribute("target", "_blank");
  await expect(links.last()).toHaveAttribute("rel", /noopener/);
});

test("Help on the build WITH road data says what it loads and what its requests reveal, and the real requests match that copy", async ({
  page,
}) => {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await seedPlaces(page);
  await openPlanner(page);
  await findRoute(page).click();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  const tiles = urls.filter((url) => /\/data\/access-tile\./.test(url));
  expect(tiles.length).toBeGreaterThan(0);
  for (const url of tiles) {
    const parsed = new URL(url);
    // Same origin only, named for a map square and a content hash, and carrying no coordinate, label or typed text.
    expect(parsed.origin).toBe(new URL(page.url()).origin);
    expect(parsed.pathname).toMatch(
      /^\/data\/access-tile\.-?\d+_-?\d+\.[0-9a-f]{12}\.json$/,
    );
    expect(parsed.search).toBe("");
    expect(url).not.toContain(String(accessPlaces.start.latitude));
    expect(url).not.toContain(accessPlaces.start.label.replace(/ /g, "%20"));
  }
  // Only a bounded area was asked for: at most a 3 x 3 block around each of the trip's two ends, never every tile.
  const index = await (
    await page.request.get(
      "/data/" +
        (await (await page.request.get("/data/dataset.json")).json()).access
          .index.file,
    )
  ).json();
  expect(new Set(tiles).size).toBeLessThanOrEqual(18);
  expect(new Set(tiles).size).toBeLessThan(index.tiles.length + 1);
  expect(urls.filter((url) => /tile\.openstreetmap\.org/.test(url))).toEqual(
    [],
  );
  await page.getByRole("button", { name: /^Help/ }).first().click();
  const help = page.getByRole("dialog", { name: "Help and about" });
  await expect(help).toContainText("This build also loads road data");
  await expect(help).toContainText(
    "Outside the loaded features and road data there is nothing to route on",
  );
  await expect(help).toContainText(
    "road files that cover the map squares (about 1 km across, three by three)",
  );
  await expect(help).toContainText(
    "around your position while you ride or reroute",
  );
  await expect(help).toContainText(
    "The file names carry each square's grid numbers",
  );
  await expect(help).toContainText(
    "Exact GPS fixes, typed searches and saved records are not part of those requests",
  );
  await expect(help).toContainText(
    "road files are fetched by map square, and those requests show this site approximately where you are",
  );
  const copy = await help.innerText();
  expect(copy).not.toContain("is not sent by the app anywhere");
  expect(copy).not.toContain("This build has no street-access data");
  expect(copy).not.toContain("it has no road network");
  // The Data section's description names every position that actually fetches tiles (ensure() over a request's points).
  await expect(help).toContainText("around its start and destination");
  await expect(help).toContainText("your position while you ride or reroute");
  await expect(help).toContainText("a saved route's first and last points");
});
