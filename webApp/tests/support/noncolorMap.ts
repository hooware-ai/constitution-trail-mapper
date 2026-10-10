import { test, expect } from "@playwright/test";
import { openPlanner, choose } from "../webkit/support";
// Observe the real default Canvas renderer; grayscale screenshots retain its stroke patterns.
test("[engine] noncolor network patterns match text cues with a grayscale screenshot", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.stroke;
    const records: { color: string; dash: number[]; width: number }[] = [];
    Object.assign(window, { mapStrokeRecords: records });
    CanvasRenderingContext2D.prototype.stroke = function (path?: Path2D) {
      records.push({
        color: String(this.strokeStyle),
        dash: this.getLineDash(),
        width: this.lineWidth,
      });
      return Reflect.apply(original, this, path ? [path] : []);
    };
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  await page.getByText("Layers and map key", { exact: true }).click();
  await page.addStyleTag({
    content: ".leaflet-container, .legend { filter: grayscale(1); }",
  });
  const key = page.locator(".explore-layers .legend");
  const cues = [
    "solid line",
    "long dashes",
    "dash and two short ticks",
    "short ticks",
    "spaced short dashes",
    "short dashes and no-entry signs",
  ];
  for (const cue of cues) {
    const label = key.getByText(cue, { exact: true });
    await label.scrollIntoViewIfNeeded();
    await expect(label).toBeVisible();
  }
  const patterns = await key
    .locator(".legend-line > path:first-child")
    .evaluateAll((paths) =>
      paths.map((p) => p.getAttribute("stroke-dasharray") ?? "solid"),
    );
  expect(new Set(patterns).size).toBe(patterns.length);
  const strokes = await page.evaluate(
    () =>
      (
        window as unknown as {
          mapStrokeRecords: { color: string; dash: number[]; width: number }[];
        }
      ).mapStrokeRecords,
  );
  const samples = await key
    .locator(".legend-line > path:first-child")
    .evaluateAll((paths) =>
      paths.map((p) => ({
        color: p.getAttribute("stroke"),
        dash: (p.getAttribute("stroke-dasharray") ?? "")
          .split(" ")
          .filter(Boolean)
          .map(Number),
      })),
    );
  for (const sample of samples) {
    const drawn = strokes.filter(
      (s) => s.color === sample.color && s.width === 4,
    );
    if (drawn.length)
      expect(
        drawn.every(
          (s) => JSON.stringify(s.dash) === JSON.stringify(sample.dash),
        ),
      ).toBe(true);
  }
  expect(
    strokes.some(
      (s) => s.color === "#08725f" && s.width === 4 && s.dash.length === 0,
    ),
  ).toBe(true);
  expect(
    strokes.some(
      (s) =>
        s.color === "#63a375" &&
        s.width === 4 &&
        JSON.stringify(s.dash) === "[12,4]",
    ),
  ).toBe(true);
  expect(
    strokes.some(
      (s) =>
        s.color === "#68718b" &&
        s.width === 4 &&
        JSON.stringify(s.dash) === "[3,3]",
    ),
  ).toBe(true);
  const toggle = page.getByRole("checkbox", { name: /Show proposed trails/ });
  await expect(toggle).not.toBeChecked();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { mapStrokeRecords: { color: string }[] }
      ).mapStrokeRecords.some((s) => s.color === "#7851a9"),
    ),
  ).toBe(false);
  await toggle.check();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            mapStrokeRecords: { color: string; dash: number[] }[];
          }
        ).mapStrokeRecords.some(
          (s) => s.color === "#7851a9" && JSON.stringify(s.dash) === "[6,7]",
        ),
      ),
    )
    .toBe(true);
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await page.setViewportSize({ width: 640, height: 320 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "150%";
  });
  await key.getByText("long dashes", { exact: true }).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".map")
      .first()
      .evaluate((e) => {
        const r = e.getBoundingClientRect();
        return Math.min(r.bottom, innerHeight) - Math.max(0, r.top);
      }),
  ).toBeGreaterThanOrEqual(100);
  await page.screenshot({
    path: test.info().outputPath("noncolor-grayscale.png"),
  });
  expect(errors).toEqual([]);
});

test("[engine] heavier selected route retains open noncolor gaps and white casing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.stroke;
    const records: {
      color: string;
      dash: number[];
      width: number;
      cap: string;
    }[] = [];
    Object.assign(window, { routeStrokeRecords: records });
    CanvasRenderingContext2D.prototype.stroke = function (path?: Path2D) {
      records.push({
        color: String(this.strokeStyle),
        dash: this.getLineDash(),
        width: this.lineWidth,
        cap: this.lineCap,
      });
      return Reflect.apply(original, this, path ? [path] : []);
    };
  });
  // Existing fixture-h-2-0 is a real admitted ParkConnectors edge in the synthetic router data.
  await page.addInitScript(() => {
    localStorage.setItem(
      "trail-mapper.fixture:trail-mapper.web.library.v1",
      JSON.stringify({
        version: 1,
        saved: [],
        recent: [],
        places: [
          {
            key: "park-from",
            label: "Pattern park start",
            latitude: 40.51,
            longitude: -88.99,
            createdAt: 1,
          },
          {
            key: "park-to",
            label: "Pattern park end",
            latitude: 40.51,
            longitude: -88.98,
            createdAt: 1,
          },
        ],
      }),
    );
  });
  await openPlanner(page);
  await choose(page, "Start", "Pattern park start");
  await choose(page, "Destination", "Pattern park end");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            routeStrokeRecords: {
              color: string;
              width: number;
              cap: string;
              dash: number[];
            }[];
          }
        ).routeStrokeRecords.some(
          (r) =>
            r.color === "#63a375" &&
            r.width === 6 &&
            r.cap === "butt" &&
            JSON.stringify(r.dash) === "[12,4]",
        ),
      ),
    )
    .toBe(true);
  const records = await page.evaluate(
    () =>
      (
        window as unknown as {
          routeStrokeRecords: {
            color: string;
            dash: number[];
            width: number;
            cap: string;
          }[];
        }
      ).routeStrokeRecords,
  );
  expect(records.some((r) => r.color === "#ffffff" && r.width === 10)).toBe(
    true,
  );
  const route = records.filter(
    (r) =>
      r.width === 6 &&
      ["#08725f", "#63a375", "#68718b", "#4d6888", "#7851a9"].includes(r.color),
  );
  expect(route.length).toBeGreaterThan(0);
  expect(route.some((stroke) => stroke.dash.length > 0)).toBe(true);
  for (const stroke of route) {
    if (stroke.dash.length) {
      expect(stroke.cap).toBe("butt");
      expect(
        stroke.dash.filter((_, i) => i % 2 === 1).every((g) => g >= 3),
      ).toBe(true);
    } else expect(stroke.cap).toBe("round");
  }
  await page.addStyleTag({
    content: ".leaflet-container, .legend {filter:grayscale(1);}",
  });
  await page.screenshot({
    path: test.info().outputPath("route-grayscale.png"),
  });
});
