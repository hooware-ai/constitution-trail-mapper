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
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
      expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
      // Checks actual hit testing, including an expanded details card covering Stop.
      await stop.click({ trial: true });
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
    await page
      .getByRole("button", { name: "Stop navigation", exact: true })
      .click();
    await expect(startButton(page)).toBeVisible();
  });
}
