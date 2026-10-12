import { expect, type Page } from "@playwright/test";
import { planPoint, simulateDevice, startButton } from "../webkit/support";

/** Real app/worker/router with a scripted location provider, not physical GPS. */
export async function startAndHelpAreReachable(
  page: Page,
  viewport: { width: number; height: number },
  largeText = false,
) {
  await page.setViewportSize(viewport);
  await simulateDevice(page);
  await planPoint(page);
  if (largeText)
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
  const start = startButton(page),
    help = page.getByRole("button", { name: "Help and about", exact: true });
  await expect(start).toBeEnabled();
  await expect(help).toBeVisible();
  await expect(page.locator(".help-only-nav")).toHaveCount(0);
  await start.scrollIntoViewIfNeeded();
  for (const button of [start, help]) {
    expect(
      await button.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return element === hit || element.contains(hit);
      }),
    ).toBe(true);
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    // Native pointer hit checks with no force must succeed on both controls.
    await button.click({ trial: true });
  }
  const s = await start.boundingBox(),
    h = await help.boundingBox();
  expect(h!.x).toBeGreaterThanOrEqual(s!.x + s!.width);
  await help.click();
  await expect(
    page.getByRole("dialog", { name: "Help and about" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await start.click();
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__device.watching()))
    .toBe(1);
}
