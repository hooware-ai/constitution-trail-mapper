import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fix, simulateDevice } from "../webkit/support";

// A saved route rebuilt from the owner's screenshot (start 111 ft, "Near S Hershey Rd" 37 ft, "Near Prospect Ave" under 1 ft,
// destination 90 ft), opened through the real preview. Notification cards are temporarily hidden; genuine interior
// connections remain mapped, keyboard-accessible and unverified, and all routing blockers stay in force.
type Seg = {
  type: "Trail" | "Access";
  from: number;
  to: number;
  routed: boolean;
  name?: string;
};
const FT = 0.3048;
const SEGMENTS: Seg[] = [
  { type: "Access", from: -111 * FT, to: 0, routed: false },
  { type: "Access", from: 0, to: 150, routed: true, name: "S Hershey Rd" },
  { type: "Access", from: 150, to: 150 + 37 * FT, routed: false },
  { type: "Trail", from: 150 + 37 * FT, to: 600, routed: true },
  { type: "Access", from: 600, to: 600.08, routed: false },
  { type: "Access", from: 600.08, to: 800, routed: true, name: "Prospect Ave" },
  { type: "Access", from: 800, to: 800 + 90 * FT, routed: false },
];

async function openSeeded(page: Page) {
  await page.addInitScript((segments) => {
    const key = "trail-mapper.fixture:trail-mapper.web.library.v1";
    if (localStorage.getItem(key)) return;
    const at = (north: number) => ({
      latitude: 40.5 + north / 111_195,
      longitude: -88.95,
    });
    const total = segments.reduce((sum, s) => sum + Math.abs(s.to - s.from), 0);
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        saved: [
          {
            key: "seeded-screenshot",
            title: "Screenshot route",
            createdAt: Date.now(),
            usedAt: Date.now(),
            route: {
              segments: segments.map((s) => ({
                type: s.type,
                points: [at(s.from), at(s.to)],
                isRouted: s.routed,
                name: s.name ?? null,
                routeRoles: [],
              })),
              totalDistanceMeters: total,
              ordinaryAccessDistanceMeters: total,
              totalCost: 1,
              kind: "Navigation",
            },
            draft: {
              mode: "point",
              start: { label: "Private start", ...at(segments[0].from) },
              destination: {
                label: "Private end",
                ...at(segments[segments.length - 1].to),
              },
              miles: 5,
              proposed: false,
            },
          },
        ],
        recent: [],
        places: [],
      }),
    );
  }, SEGMENTS);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Screenshot route/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
}

test("start, intermediate and end connections allow navigation without notification cards or a confirmation hurdle", async ({
  page,
}, info) => {
  await page.clock.install();
  await simulateDevice(page);
  await openSeeded(page);
  await expect(page.locator(".access-connections")).toHaveCount(0);
  await expect(page.locator("#connections-title")).toHaveCount(0);
  await expect(page.locator(".connection-total")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: /connections? to check/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/select one to see it/)).toHaveCount(0);
  await expect(page.locator(".connection-marker")).toHaveCount(1);
  // All three connections remain estimated; the sub-foot mapped join is not a separate gap.
  await expect(
    page.locator('.map-wrap[data-estimated-connections="3"]'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(/still has estimated connections that are not confirmed/),
  ).toHaveCount(0);
  await expect(page.locator(".start-reason")).toHaveCount(0);
  await expect(
    page.locator(".warning").filter({ hasText: /estimated|unverified/i }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("three-connections-start-enabled.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ride in progress", exact: true }),
  ).toBeVisible();
  // Drive the existing route through its driveway, intermediate connector and destination.
  // Browser-scoped synthetic GPS only; no real location or user record is changed.
  const progress: number[] = [];
  for (const north of [
    -111 * FT,
    0,
    75,
    150,
    150 + 37 * FT,
    225,
    300,
    375,
    450,
    525,
    600,
    675,
    750,
    800,
    800 + 90 * FT,
  ]) {
    await page.clock.fastForward(30_000);
    await fix(page, 40.5 + north / 111_195, -88.95);
    await expect(page.locator(".guidance.navigating")).toBeVisible();
    const stored = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          "trail-mapper.fixture:trail-mapper.web.active-ride.v1",
        )!,
      ),
    );
    progress.push(stored.routeProgressMeters);
  }
  expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
  expect(progress.at(-1)).toBeGreaterThan(800);
  await info.attach("connector-progress.json", {
    body: JSON.stringify(progress),
    contentType: "application/json",
  });
});

test("the remaining unverified map marker works by keyboard without a notification card", async ({
  page,
}, info) => {
  await openSeeded(page);
  await expect(page.locator(".access-connections")).toHaveCount(0);
  const map = page.getByRole("region", {
    name: "Route map with unverified connections",
    exact: true,
  });
  const marker = map.getByRole("button", {
    name: /Connection 1: S Hershey Rd to trail/,
  });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  for (let tabs = 0; tabs < 40; tabs++) {
    if (await marker.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(marker).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".leaflet-popup")).toContainText(
    "Map data does not confirm a traversable connection here",
  );
  const box = await marker.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  await page
    .getByRole("button", { name: "Close popup", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "Fit route", exact: true }).click();
  await marker.press("Enter");
  await expect(marker).toBeFocused();
  await expect(page.locator(".leaflet-popup")).toBeVisible();
  // Leaflet fades this popup in. Audit the readable state, rather than sampling blended colors mid-animation.
  await expect(page.locator(".leaflet-popup")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: `output/playwright/interior-connection-focus-${info.project.name}.png`,
    fullPage: true,
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
