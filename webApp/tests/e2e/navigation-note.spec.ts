import { test, expect } from "@playwright/test";
import {
  simulateDevice,
  planPoint,
  startButton,
  fix,
  setVisible,
} from "../webkit/support";

// Real app/worker/router, simulated location and visibility; no physical-phone claim.
test("navigation note exists only during active turn-by-turn guidance", async ({
  page,
}) => {
  await simulateDevice(page);
  await planPoint(page);
  const note = page
    .getByRole("note")
    .filter({ hasText: "Navigation is in beta and may experience issues." });
  await expect(note).toHaveCount(0);
  await startButton(page).click();
  await expect(page.locator(".ride-guidance h2")).toHaveText(
    "Reacquiring location…",
  );
  await expect(note).toHaveCount(0);
  await fix(page, 40.51, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await expect(note).toBeVisible();
  await expect(note).toBeInViewport();
  await setVisible(page, false);
  await expect(page.locator(".ride-guidance h2")).toHaveText(
    "Navigation paused",
  );
  await expect(note).toHaveCount(0);
  await setVisible(page, true);
  await expect(note).toHaveCount(0);
  await fix(page, 40.51, -88.95);
  await expect(note).toBeVisible();
  await page.evaluate(() => (window as any).__device.fail(2));
  await expect(page.locator(".ride-guidance h2")).toHaveText("Location lost");
  await expect(note).toHaveCount(0);
  await fix(page, 40.51, -88.95);
  await expect(note).toBeVisible();
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await expect(note).toHaveCount(0);
});
