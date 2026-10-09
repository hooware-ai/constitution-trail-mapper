// A tap on a map credit link during a ride must not take the page away from the ride. External hosts are blocked, so
// nothing outside this machine is contacted.
import { test, expect } from "@playwright/test";
import { fix, planPoint, simulateDevice, startButton } from "../webkit/support";

test("tapping the flat-map credit during a ride opens a new tab and the ride carries on", async ({
  page,
  context,
}) => {
  await context.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    (route) => route.abort(),
  );
  // The default ride map uses WebGL and the synthetic fixture has no external
  // credit link there. Exercise Leaflet's real, visible attribution in the
  // no-WebGL ride fallback instead of selecting its inactive DOM node.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type,
      ...args
    ) {
      if (type === "webgl2") return null;
      return getContext.call(this, type, ...args);
    } as typeof getContext;
  });
  await simulateDevice(page);
  await planPoint(page);
  await startButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await fix(page, 40.51, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await expect(page.locator(".ride-map-fallback .map-wrap")).toBeVisible();
  const before = page.url();
  const link = page
    .locator(".ride-map-fallback .leaflet-control-attribution a")
    .first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  const opened = context.waitForEvent("page");
  await link.click();
  const tab = await opened;
  expect(tab).not.toBe(page);
  await tab.close();
  expect(page.url()).toBe(before);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
});
