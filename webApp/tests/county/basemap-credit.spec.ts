// The optional street basemap and its OpenStreetMap credit, in the county build (the fixture build has no basemap). Tiles
// are STUBBED: every request to the tile host is answered locally with a 1x1 image and any other outside host is aborted,
// so this suite can never request a real tile.
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const COPYRIGHT = "https://www.openstreetmap.org/copyright";

async function stubTiles(page: Page) {
  const tiles: string[] = [];
  await page.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "tile.openstreetmap.org") {
        tiles.push(url.pathname);
        return route.fulfill({ contentType: "image/png", body: PIXEL });
      }
      return route.abort();
    },
  );
  return tiles;
}
const credit = (page: Page) =>
  page.locator(".leaflet-control-attribution a", {
    hasText: "OpenStreetMap contributors",
  });
const toggle = (page: Page) =>
  page.getByRole("checkbox", { name: "Street basemap (online)" });

test("tiles are off by default and nothing credits or requests OpenStreetMap until the rider turns them on", async ({
  page,
}) => {
  const tiles = await stubTiles(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await expect(toggle(page)).not.toBeChecked();
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
  await toggle(page).check();
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
  await toggle(page).uncheck();
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
  await toggle(page).check();
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
  await toggle(page).check();
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
    await toggle(page).check();
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
    await toggle(page).scrollIntoViewIfNeeded();
    expect(
      await toggle(page).evaluate((e) => {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return hit === e || hit?.closest("label") === e.closest("label");
      }),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Fit network", exact: true })
      .click();
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
    await toggle(page).uncheck();
    await expect(status).toHaveCount(0);
    await expect(toggle(page)).not.toBeChecked();
    await expect(liveRegion).toHaveText("");
    await toggle(page).check();
    await expect(status).toBeInViewport();
    await expect(status).toHaveAttribute("data-original-region", "yes");
    await toggle(page).uncheck();
    await expect(liveRegion).toHaveText("");
    expect(errors).toEqual([]);
  });
}
