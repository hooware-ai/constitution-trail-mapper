import { test, expect, type Page } from "@playwright/test";
import { simulateDevice, planPoint, startButton, fix } from "../webkit/support";

async function reachableRide(page: Page) {
  const guidance = await page.locator(".ride-guidance").boundingBox();
  expect(
    guidance!.height,
    "guidance retains readable space",
  ).toBeGreaterThanOrEqual(100);
  const stop = page.getByRole("button", {
    name: "Stop navigation",
    exact: true,
  });
  const box = await stop.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
  expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
  await expect(stop).toBeVisible();
  // Visibility alone does not detect a details panel covering the control.
  await stop.click({ trial: true });
  const heading = page.locator(".ride-guidance h2");
  expect(
    await heading.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const card = el.closest(".ride-guidance")!.getBoundingClientRect();
      return (
        box.top >= card.top &&
        box.bottom <= card.bottom &&
        el.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        )
      );
    }),
    "instruction is visible and not covered by map controls",
  ).toBe(true);
}

test("large-text ride guidance and Stop remain reachable on a short phone", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 375, height: 480 });
  await simulateDevice(page);
  await planPoint(page);
  await startButton(page).click();
  await fix(page, 40.505, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await expect(page.locator(".ride-map-canvas")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  await reachableRide(page);
  await context.setOffline(true);
  await expect(page.locator(".ride-offline")).toBeVisible();
  await reachableRide(page);
  await page.locator(".ride-details summary").click();
  await reachableRide(page);
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  await expect(startButton(page)).toBeVisible();
});
