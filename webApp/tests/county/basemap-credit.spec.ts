// The optional street basemap and its OpenStreetMap credit, in the county build (the fixture build has no basemap). Tiles
// are STUBBED: every request to the tile host is answered locally with a 1x1 image and any other outside host is aborted,
// so this suite can never request a real tile.
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator, type Page } from "@playwright/test";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const COPYRIGHT = "https://www.openstreetmap.org/copyright";

async function stubTiles(page: Page) {
  const tiles: string[] = [];
  await page.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "tile.openstreetmap.org") {
        await route.fulfill({ contentType: "image/png", body: PIXEL });
        tiles.push(url.pathname);
        return;
      }
      return route.abort();
    },
  );
  return tiles;
}
// Opening the picker changes the map's size. Leaflet's ResizeObserver/invalidateSize can round the pixel centre
// before the rider taps anything; capture a baseline only after one atomic camera/size snapshot has stayed unchanged.
async function settledPickerCamera(map: Locator) {
  let previous = "",
    unchangedSince = 0;
  let settled = { center: "", zoom: "", clientWidth: 0, clientHeight: 0 };
  await expect
    .poll(
      async () => {
        const current = await map.evaluate((element) => ({
          center: element.getAttribute("data-center") ?? "",
          zoom: element.getAttribute("data-zoom") ?? "",
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
        }));
        const snapshot = JSON.stringify(current),
          now = performance.now();
        if (
          !current.center ||
          !current.zoom ||
          current.clientWidth <= 0 ||
          current.clientHeight <= 0
        ) {
          previous = "";
          unchangedSince = now;
          return false;
        }
        if (snapshot !== previous) {
          previous = snapshot;
          unchangedSince = now;
          return false;
        }
        settled = current;
        return now - unchangedSince >= 350;
      },
      { intervals: [50, 100] },
    )
    .toBe(true);
  return settled;
}
const credit = (page: Page) =>
  page.locator(".leaflet-control-attribution a", {
    hasText: "OpenStreetMap contributors",
  });
const toggle = (page: Page) =>
  page.getByRole("button", { name: "Street map", exact: true });
const exploreToggle = (page: Page) =>
  page.getByRole("checkbox", { name: "Street basemap (online)" });

test("the bottom-right road icon is striped and tappable when off, lit when on, and keyboard operable", async ({
  page,
  isMobile,
}, info) => {
  const tiles = await stubTiles(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  const button = toggle(page);
  const map = page.getByRole("region", { name: /Interactive map/ });
  const initialCenter = await map.getAttribute("data-center");
  const initialZoom = await map.getAttribute("data-zoom");
  await expect(
    page.getByRole("checkbox", { name: "Street basemap (online)" }),
  ).toHaveCount(0);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toHaveAttribute("title", /requires internet/);
  expect(await button.innerText()).toBe("");
  await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
  expect(
    await button.evaluate((e) => getComputedStyle(e).backgroundImage),
  ).toContain("repeating-linear-gradient");
  const checkPlacement = async () => {
    const b = (await button.boundingBox())!;
    const m = (await map.boundingBox())!;
    const a = (await page
      .locator(".leaflet-control-attribution")
      .boundingBox())!;
    expect(b.width).toBe(48);
    expect(b.height).toBe(48);
    expect(b.x + b.width).toBeLessThanOrEqual(m.x + m.width);
    expect(m.x + m.width - b.x - b.width).toBeLessThanOrEqual(20);
    expect(b.y).toBeGreaterThan(m.y + m.height / 2);
    expect(b.y + b.height).toBeLessThanOrEqual(a.y);
    expect(
      await button.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return hit === e || e.contains(hit);
      }),
    ).toBe(true);
  };
  await checkPlacement();
  await button.screenshot({ path: info.outputPath("street-map-off.png") });
  if (isMobile) await button.tap();
  else await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveCSS("background-image", "none");
  await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  await expect(credit(page)).toBeVisible();
  await checkPlacement();
  await button.screenshot({ path: info.outputPath("street-map-on.png") });
  await expect(map).toHaveAttribute("data-center", initialCenter!);
  await expect(map).toHaveAttribute("data-zoom", initialZoom!);
  await button.focus();
  await page.keyboard.press("Space");
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(credit(page)).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await checkPlacement();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveCSS("background-image", "none");
  await checkPlacement();
});

test("toggling street tiles in the map picker does not choose a point or pan the map", async ({
  page,
  isMobile,
}) => {
  const tiles = await stubTiles(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Pick on map", exact: true })
    .click();
  const heading = page.getByRole("heading", {
    name: "Choose start on the map",
  });
  await expect(heading).toBeVisible();
  const map = page.getByRole("region", { name: /Interactive map/ });
  await expect(page.locator(".map-error")).toHaveCount(0);
  const { center, zoom } = await settledPickerCamera(map);
  if (isMobile) await toggle(page).tap();
  else await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  await expect(page.locator(".map-error")).toHaveCount(0);
  await expect(heading).toBeVisible();
  await expect(map).toHaveAttribute("data-center", center!);
  await expect(map).toHaveAttribute("data-zoom", zoom!);
  await page
    .getByRole("button", { name: "Cancel map selection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Start:/ }),
  ).toHaveAccessibleName("Start: Choose a place");
});

test("the road control preserves automatic route-preview fitting through resize", async ({
  page,
  isMobile,
}) => {
  await stubTiles(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const places = [
      {
        key: "toggle-west",
        label: "Toggle proof west",
        latitude: 40.5,
        longitude: -88.99,
        createdAt: 1,
      },
      {
        key: "toggle-north",
        label: "Toggle proof north",
        latitude: 40.52,
        longitude: -88.97,
        createdAt: 1,
      },
    ];
    if (
      !localStorage.getItem("trail-mapper.county:trail-mapper.web.library.v1")
    )
      localStorage.setItem(
        "trail-mapper.county:trail-mapper.web.library.v1",
        JSON.stringify({ version: 1, saved: [], recent: [], places }),
      );
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  for (const [field, label] of [
    ["Start", "Toggle proof west"],
    ["Destination", "Toggle proof north"],
  ]) {
    await page
      .getByRole("button", { name: new RegExp("^" + field + ":") })
      .click();
    await page.getByRole("textbox", { name: "Search places" }).fill(label);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(label) })
      .click();
  }
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  if (isMobile) await toggle(page).tap();
  else await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  const map = page.getByRole("region", { name: /Interactive map/ });
  const initialZoom = await map.getAttribute("data-zoom");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(map).not.toHaveAttribute("data-zoom", initialZoom!);
  const resizedZoom = await map.getAttribute("data-zoom");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await expect(map).toHaveAttribute("data-zoom", resizedZoom!);
});

test("the square reset icon restores the first loaded county view after pan, zoom and resize", async ({
  page,
}) => {
  const tiles = await stubTiles(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  const map = page.getByRole("region", { name: /Interactive map/ });
  const reset = page.getByRole("button", { name: "Reset map", exact: true });
  await expect(reset).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit network" })).toHaveCount(
    0,
  );
  await expect(map).toHaveAttribute("data-center", /,/);
  const initialCenter = await map.getAttribute("data-center");
  const initialZoom = await map.getAttribute("data-zoom");
  const viewport = page.viewportSize()!;

  for (const fontSize of ["100%", "200%"] as const) {
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, fontSize);
    const box = (await reset.boundingBox())!;
    expect(box.width).toBe(48);
    expect(box.height).toBe(48);
    expect(await reset.innerText()).toBe("");
    await expect(reset.locator("svg")).toHaveAttribute("aria-hidden", "true");
    expect(
      await reset.evaluate((button) => {
        const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return hit === button || button.contains(hit);
      }),
    ).toBe(true);

    await map.focus();
    await page.keyboard.press("ArrowRight");
    await expect(map).not.toHaveAttribute("data-center", initialCenter!);
    await page.keyboard.press("+");
    await expect(map).not.toHaveAttribute("data-zoom", initialZoom!);
    await reset.focus();
    await page.keyboard.press("Enter");
    await expect(reset).toBeFocused();
    await expect(map).toHaveAttribute("data-center", initialCenter!);
    await expect(map).toHaveAttribute("data-zoom", initialZoom!);

    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height + 80,
    });
    await map.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(map).not.toHaveAttribute("data-center", initialCenter!);
    await page.keyboard.press("-");
    await expect(map).not.toHaveAttribute("data-zoom", initialZoom!);
    await reset.click();
    await expect(map).toHaveAttribute("data-center", initialCenter!);
    await expect(map).toHaveAttribute("data-zoom", initialZoom!);
    await page.setViewportSize(viewport);
  }
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  expect(tiles).toEqual([]);
});

test("tiles are off by default and nothing credits or requests OpenStreetMap until the rider turns them on", async ({
  page,
}) => {
  const tiles = await stubTiles(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(credit(page)).toHaveCount(0);
  expect(tiles).toEqual([]);
});

test("turning the basemap on shows a visible, clickable OpenStreetMap credit that opens the copyright page safely, and turning it off removes it", async ({
  page,
}) => {
  const tiles = await stubTiles(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await toggle(page).click();
  const link = credit(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveText("© OpenStreetMap contributors");
  await expect(link).toHaveAttribute("href", COPYRIGHT);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  // Tiles were requested, and only through the stub.
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  expect(tiles.every((path) => /^\/\d+\/\d+\/\d+\.png$/.test(path))).toBe(true);
  // The county data credit stays beside it.
  await expect(page.locator(".leaflet-control-attribution")).toContainText(
    "McGIS and members",
  );
  await toggle(page).click();
  await expect(credit(page)).toHaveCount(0);
});

test("the credit fits the screen, is not covered by another control and has no accessibility violations", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await toggle(page).click();
  const link = credit(page);
  await expect(link).toBeVisible();
  const box = (await link.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width + 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  // It is the element at its own centre: nothing sits on top of it.
  const topmost = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href"),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(topmost).toBe(COPYRIGHT);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("every link in the map credit opens in a new tab without handing over the page, so a tap cannot end a ride", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  const own = page.locator(".leaflet-control-attribution a");
  // The data credits (McGIS, CC BY 4.0) are there before any tile is on; the OpenStreetMap credit joins them when it is.
  await expect(own.first()).toBeVisible();
  await toggle(page).click();
  await expect(credit(page)).toBeVisible();
  const links = await own.evaluateAll((anchors) =>
    anchors.map((a) => ({
      text: a.textContent,
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel"),
    })),
  );
  expect(links.length).toBeGreaterThanOrEqual(3);
  for (const link of links) {
    expect(link.target, link.text ?? "").toBe("_blank");
    expect(link.rel, link.text ?? "").toMatch(/noopener/);
    expect(link.rel, link.text ?? "").toMatch(/noreferrer/);
  }
});

for (const fontSize of ["100%", "150%"] as const) {
  test(`Explore tile failure preserves map controls and attribution at ${fontSize} text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 320 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://tile.openstreetmap.org/**", (route) =>
      route.abort(),
    );
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Go somewhere/ }),
    ).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Explore", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Trails around you" }),
    ).toBeVisible();
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, fontSize);
    await page.getByText("Layers and map key", { exact: true }).click();
    const liveRegion = page.locator("#explore-basemap-notice");
    await expect(liveRegion).toHaveText("");
    await expect(liveRegion).toHaveAttribute("role", "status");
    await liveRegion.evaluate((e) =>
      e.setAttribute("data-original-region", "yes"),
    );
    await exploreToggle(page).check();
    const status = page.getByText(
      "Street map unavailable. Trail geometry remains visible.",
      { exact: true },
    );
    await expect(status).toBeVisible();
    await expect(status).toBeInViewport();
    await expect(status).toHaveAttribute("data-original-region", "yes");
    expect(await status.evaluate((e) => Boolean(e.closest(".panel")))).toBe(
      true,
    );
    await exploreToggle(page).scrollIntoViewIfNeeded();
    expect(
      await exploreToggle(page).evaluate((e) => {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return hit === e || hit?.closest("label") === e.closest("label");
      }),
    ).toBe(true);
    await page.getByRole("button", { name: "Reset map", exact: true }).click();
    const attribution = credit(page);
    await expect(attribution).toBeInViewport();
    expect(
      await attribution.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return (
          hit === e || Boolean(hit?.closest(".leaflet-control-attribution"))
        );
      }),
    ).toBe(true);
    await exploreToggle(page).uncheck();
    await expect(status).toHaveCount(0);
    await expect(exploreToggle(page)).not.toBeChecked();
    await expect(liveRegion).toHaveText("");
    await exploreToggle(page).check();
    await expect(status).toBeInViewport();
    await expect(status).toHaveAttribute("data-original-region", "yes");
    await exploreToggle(page).uncheck();
    await expect(liveRegion).toHaveText("");
    expect(errors).toEqual([]);
  });
}
