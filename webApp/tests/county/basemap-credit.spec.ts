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
