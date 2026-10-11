import { test, expect } from "@playwright/test";
import { simulateDevice, planPoint, startButton, fix } from "../webkit/support";

// Real app and Kotlin fixture router; GPS/error callbacks are scripted browser APIs.
// Viewport resizing is layout emulation, not physical phone orientation or permission acceptance.
for (const [name, width, height, font, rotate] of [
  ["short landscape", 640, 320, 16, false],
  ["short landscape 150%", 640, 320, 24, false],
  ["short landscape 200%", 640, 320, 32, false],
  ["wide landscape 150%", 844, 390, 24, false],
  ["wide landscape 200%", 844, 390, 32, false],
  ["portrait to short landscape 150%", 640, 320, 24, true],
] as const) {
  test(`[sim-device] Stop stays reachable in ${name}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(
      rotate ? { width: 390, height: 844 } : { width, height },
    );
    await simulateDevice(page);
    await page.addInitScript(() => {
      const Original = window.Worker;
      window.Worker = class extends Original {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (
            new URL(String(url), location.href).pathname.endsWith("/worker.ts")
          )
            (window as any).__rideLayoutRoutingWorker = this;
        }
      };
    });
    await planPoint(page);
    await startButton(page).click();
    await expect(
      page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as any).__device.watching()))
      .toBeGreaterThan(0);
    await page.evaluate((font) => {
      document.documentElement.style.fontSize = `${font}px`;
    }, font);
    if (rotate) await page.setViewportSize({ width, height });

    async function reachableStop() {
      const stop = page.getByRole("button", {
        name: "Stop navigation",
        exact: true,
      });
      const box = await stop.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
      expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
      // Checks actual hit testing, including an expanded details card covering Stop.
      await stop.click({ trial: true });
      const details = page.locator(".ride-details summary");
      const detailsBox = await details.boundingBox();
      expect(detailsBox!.y).toBeGreaterThanOrEqual(0);
      expect(detailsBox!.y + detailsBox!.height).toBeLessThanOrEqual(
        height + 1,
      );
      expect(
        Math.min(detailsBox!.width, detailsBox!.height),
      ).toBeGreaterThanOrEqual(44);
      await details.click({ trial: true });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }

    await reachableStop();
    await fix(page, 40.505, -88.95);
    await expect(page.locator(".guidance.navigating")).toBeVisible();
    await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
      "data-ready",
      "true",
    );
    await reachableStop();
    const credit = page.locator(".ride-credit");
    await expect(credit).toBeInViewport({ ratio: 1 });
    expect(
      await credit.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return [
          [r.left + 10, r.top + 10],
          [r.right - 10, r.top + 10],
          [r.left + 10, r.bottom - 10],
          [r.right - 10, r.bottom - 10],
          [r.left + r.width / 2, r.top + r.height / 2],
        ].every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
      }),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Following", exact: true })
      .click({ trial: true });
    const map = await page.locator(".ride-map-canvas").boundingBox();
    const info = await page.locator(".navigation .panel").boundingBox();
    expect(map!.x).toBeGreaterThanOrEqual(info!.x + info!.width - 1);
    expect(map!.height).toBeGreaterThanOrEqual(height - 1);
    await context.setOffline(true);
    await expect(page.locator(".ride-offline")).toBeVisible();
    await reachableStop();
    await page.locator(".ride-details summary").click();
    await reachableStop();
    await page.evaluate(() => (window as any).__device.fail(2));
    await expect(
      page.getByRole("heading", { name: "Location lost", exact: true }),
    ).toBeVisible();
    await reachableStop();
    await page.evaluate(() => (window as any).__device.fail(1));
    await expect(
      page.getByRole("heading", { name: "Location blocked", exact: true }),
    ).toBeVisible();
    await reachableStop();
    // Real worker and route; only its transport-error event is scripted.
    await page.evaluate(() =>
      (window as any).__rideLayoutRoutingWorker.dispatchEvent(
        new ErrorEvent("error"),
      ),
    );
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Route planning stopped" });
    await expect(alert).toBeVisible();
    expect(
      await alert.evaluate((el) => !!el.closest(".ride-dock-content")),
    ).toBe(true);
    await reachableStop();
    await context.setOffline(false);
    await expect(page.locator(".ride-offline")).toHaveCount(0);
    await alert.getByRole("button", { name: "Restart route planning" }).click();
    await expect(page.getByText("Route planning restarted")).toBeVisible();
    await reachableStop();
    await page
      .getByRole("button", { name: "Stop navigation", exact: true })
      .click();
    await expect(startButton(page)).toBeVisible();
  });
}
