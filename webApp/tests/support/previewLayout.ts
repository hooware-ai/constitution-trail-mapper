import { test, expect } from "@playwright/test";
import { planPoint } from "../webkit/support";

for (const [name, width, height, font] of [
  ["portrait", 390, 844, 16],
  ["short landscape", 640, 320, 16],
  ["short landscape 150%", 640, 320, 24],
  ["narrow 200%", 320, 640, 32],
] as const) {
  test(`[engine] preview route is unobscured by its controls in ${name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript((font) => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.fontSize = `${font}px`;
      });
      const Original = window.Worker;
      window.Worker = class extends Original {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          this.addEventListener("message", ({ data }) => {
            if (data.result?.segments)
              (window as any).__previewRoute = data.result;
          });
        }
      } as typeof Worker;
    }, font);
    await planPoint(page);
    await page.evaluate(() => scrollTo(0, 0));
    await expect
      .poll(() => page.evaluate(() => !!(window as any).__previewRoute))
      .toBe(true);
    const check = async () => {
      // Project the genuine router vertices using Leaflet's published camera,
      // rather than substituting a route or asserting only the container size.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const element = document.querySelector(".map")!;
            const rect = element.getBoundingClientRect();
            const [latitude, longitude] = element
              .getAttribute("data-center")!
              .split(",")
              .map(Number);
            const scale = 256 * 2 ** Number(element.getAttribute("data-zoom"));
            const project = (lat: number, lng: number) => {
              const sin = Math.sin((lat * Math.PI) / 180);
              return [
                ((lng + 180) / 360) * scale,
                (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
              ];
            };
            const center = project(latitude, longitude);
            const points = (window as any).__previewRoute.segments.flatMap(
              (s: any) => s.points,
            );
            if (!points.length) return false;
            return points.every((p: any) => {
              const q = project(p.latitude, p.longitude);
              const x = q[0] - center[0] + rect.width / 2;
              const y = q[1] - center[1] + rect.height / 2;
              return (
                x >= 8 && y >= 8 && x <= rect.width - 8 && y <= rect.height - 8
              );
            });
          }),
        )
        .toBe(true);
      const m = await page.evaluate(() => {
        const box = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        const map = box(".map"),
          dock = box(".start-dock"),
          tools = box(".map-tools");
        return {
          map,
          dock,
          tools,
          viewport: innerHeight,
          overlap:
            Math.min(map.right, dock.right) > Math.max(map.x, dock.x) &&
            Math.min(map.bottom, dock.bottom) > Math.max(map.y, dock.y),
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      expect(m.map.height).toBeGreaterThanOrEqual(150);
      expect(m.map.y).toBeGreaterThanOrEqual(0);
      expect(m.map.bottom).toBeLessThanOrEqual(m.viewport + 1);
      expect(m.tools.y).toBeGreaterThanOrEqual(m.map.bottom - 1);
      expect(m.overlap).toBe(false);
      expect(m.overflow).toBe(false);
      await expect(
        page.locator(".leaflet-control-attribution"),
      ).toBeInViewport();
    };
    await check();
    await page.setViewportSize({ width, height: height + 60 });
    await check();
    await page.setViewportSize({ width, height });
    await check();
    const map = page.locator(".map");
    const fittedCenter = await map.getAttribute("data-center");
    await map.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => map.getAttribute("data-center"))
      .not.toBe(fittedCenter);
    const manualCenter = (await map.getAttribute("data-center"))!
      .split(",")
      .map(Number);
    const manualZoom = await map.getAttribute("data-zoom");
    await page.setViewportSize({ width, height: height + 60 });
    await expect.poll(() => map.getAttribute("data-zoom")).toBe(manualZoom);
    const resizedCenter = (await map.getAttribute("data-center"))!
      .split(",")
      .map(Number);
    expect(Math.abs(resizedCenter[0] - manualCenter[0])).toBeLessThan(0.0002);
    expect(Math.abs(resizedCenter[1] - manualCenter[1])).toBeLessThan(0.0002);
    await page.setViewportSize({ width, height });
    const fit = page.getByRole("button", { name: "Fit route", exact: true });
    expect((await fit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await fit.click();
    await page.evaluate(() => scrollTo(0, 0));
    await check();
    await expect(
      page.getByRole("button", { name: "Start navigation", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Directions", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Directions" }).locator("ol li"),
    ).not.toHaveCount(0);
    await page
      .getByRole("button", { name: "Close Directions", exact: true })
      .click();
  });
}
