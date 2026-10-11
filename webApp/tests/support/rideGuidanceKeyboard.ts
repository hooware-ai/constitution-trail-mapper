import { test, expect } from "@playwright/test";
import { simulateDevice, planPoint, startButton, fix } from "../webkit/support";

test("[sim-device] clipped ride guidance can be reached and scrolled by keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 320 });
  await simulateDevice(page);
  await planPoint(page);
  await startButton(page).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__device.watching()))
    .toBeGreaterThan(0);
  await fix(page, 40.505, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  const guidance = page.locator(".ride-guidance");
  const before = await guidance.evaluate((e) => ({
    height: e.clientHeight,
    content: e.scrollHeight,
    overflow: getComputedStyle(e).overflowY,
  }));
  console.log(JSON.stringify({ guidance: before }));
  expect(before.content).toBeGreaterThan(before.height + 1);
  expect(before.overflow).toBe("auto");
  let reached = false;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (await guidance.evaluate((e) => e === document.activeElement)) {
      reached = true;
      break;
    }
  }
  expect(
    reached,
    "Keyboard must reach the clipped guidance, without programmatic focus",
  ).toBe(true);
  expect(await guidance.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe(
    "solid",
  );
  await page.keyboard.press("End");
  await expect
    .poll(() => guidance.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  const bottom = await guidance
    .locator(".ride-guidance-copy > :last-child")
    .boundingBox();
  const box = await guidance.boundingBox();
  expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(
    box!.y + box!.height + 1,
  );
  await page.keyboard.press("Tab");
  expect(await guidance.evaluate((e) => e === document.activeElement)).toBe(
    false,
  );
  const stop = page.getByRole("button", {
    name: "Stop navigation",
    exact: true,
  });
  const stopBox = await stop.boundingBox();
  expect(stopBox!.y + stopBox!.height).toBeLessThanOrEqual(321);
  await stop.click();
  await expect(page.locator(".ride-guidance")).toHaveCount(0);
});

test("[sim-device] guidance enters the keyboard order only while clipped and can recover after rotation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await simulateDevice(page);
  await planPoint(page);
  await startButton(page).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__device.watching()))
    .toBeGreaterThan(0);
  await fix(page, 40.505, -88.95);
  const guidance = page.getByRole("region", {
    name: "Ride guidance",
    exact: true,
  });
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await expect(guidance).toHaveAttribute("tabindex", "-1");
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  await page.setViewportSize({ width: 640, height: 320 });
  await expect(guidance).toHaveAttribute("tabindex", "0");
  await page.evaluate(() => (window as any).__device.fail(1));
  await expect(
    page.getByRole("heading", { name: "Location blocked", exact: true }),
  ).toBeVisible();
  await expect(guidance).toHaveAttribute("tabindex", "0");
  let reached = false;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (await guidance.evaluate((e) => e === document.activeElement)) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  await page.keyboard.press("End");
  await expect
    .poll(() => guidance.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  await page.evaluate(() => (document.documentElement.style.fontSize = "16px"));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(guidance).toHaveAttribute("tabindex", "-1");
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  await expect(guidance).toHaveCount(0);
  await startButton(page).click();
  await expect(
    page.getByRole("region", { name: "Ride guidance", exact: true }),
  ).toHaveAttribute("tabindex", "-1");
});
