// Production-header fixture artifact; real Kotlin router/WebKit, simulated device/location APIs.
import { test, expect, type Request } from "@playwright/test";
import { simulateDevice, planPoint, startButton, fix } from "../webkit/support";

test("[sim-device] reload before initial map-worker responses restores the ride and requires a fresh fix", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let oldDocument = true;
  const heldRequests: Request[] = [];
  const cancelled = new Set<Request>();
  const restoredRequests: Request[] = [];
  page.on("requestfailed", (request) => cancelled.add(request));
  let release = () => {};
  const preparation = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/maplibre-gl-worker-*.js", async (route) => {
    if (oldDocument) {
      heldRequests.push(route.request());
      await preparation;
      // Navigation intentionally cancels this old-document interception. No page errors are filtered.
      try {
        await route.continue();
      } catch (error) {
        if (!cancelled.has(route.request()) && !page.isClosed()) throw error;
      }
    } else {
      restoredRequests.push(route.request());
      await route.continue();
    }
  });
  try {
    await simulateDevice(page);
    await planPoint(page);
    await startButton(page).click();
    await expect(
      page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
    ).toBeVisible();
    // Device events are delivered only after the app has subscribed; clicking Start can precede that effect.
    await expect
      .poll(() => page.evaluate(() => (window as any).__device.watching()))
      .toBe(1);
    await fix(page, 40.51, -88.95);
    await expect(page.locator(".guidance.navigating")).toBeVisible();
    await expect(page.locator(".ride-map-canvas")).toBeVisible();
    await expect.poll(() => heldRequests.length).toBeGreaterThan(0);
    await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
      "data-ready",
      "false",
    );
    // Hold all initial worker responses. The new document may fetch its own workers.
    oldDocument = false;
    await page.reload();
    await expect
      .poll(() => heldRequests.every((request) => cancelled.has(request)))
      .toBe(true);
    release();
    await expect(
      page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".guidance.navigating")).not.toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as any).__device.watching()))
      .toBe(1);
    await fix(page, 40.502, -88.95);
    await expect(page.locator(".guidance.navigating")).toBeVisible();
    await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
      "data-ready",
      "true",
    );
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some((key) =>
          key.endsWith("trail-mapper.web.active-ride.v1"),
        ),
      ),
    ).toBe(true);
    const restoredOrigin = await page.evaluate(() => performance.timeOrigin);
    await expect
      .poll(() =>
        restoredRequests.some(
          (request) => request.timing().startTime >= restoredOrigin,
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
