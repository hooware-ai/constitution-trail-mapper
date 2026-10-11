// Issue #138: the rider-visible recovery copy, the browser's fix gate and the unchanged shared Kotlin rule
// (TrailRouteDeviation.isCredible: accuracy <= 25 m, age 0..10 s) must agree, while choosing a route endpoint keeps the
// planner's looser 35 m / 15 s rule.
//
// [sim-device]: the real app, worker and Kotlin router in this browser engine, fed by a scripted geolocation adapter
// with a fixed page clock. The simulated provider sets accuracy and fix time exactly; this is not physical GPS, a
// mobile browser, or OS location behavior. The app passes its own Date.now() to the worker as `now`, so the fixed clock
// governs the browser gate, the expiry timer and the core's freshness check alike. The clock only moves forward, and
// each fix is newer than the last and no older than the watch start, so only the rule under test can reject it.
import { test, expect, type Page } from "@playwright/test";
import {
  simulateDevice,
  planPoint,
  openPlanner,
  startButton,
  fix,
} from "../webkit/support";

const T0 = Math.floor(Date.now() / 1000) * 1000;
const guidance = (page: Page) => page.locator(".guidance");
const navigating = (page: Page) => page.locator(".guidance.navigating");
const at = (page: Page, offset: number) => page.clock.setFixedTime(T0 + offset);

// Observe only: every native Worker message and transfer argument is forwarded unchanged to the real worker.
const snapshotRequests = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__snapshotRequests);
async function startRide(page: Page) {
  await page.addInitScript(() => {
    (window as any).__snapshotRequests = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      if (args[0]?.request?.op === "snapshot")
        (window as any).__snapshotRequests++;
      return Reflect.apply(post, this, args);
    };
  });
  await at(page, 0);
  await simulateDevice(page);
  await planPoint(page);
  await startButton(page).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__device.watching()))
    .toBeGreaterThan(0);
}

async function expectLost(page: Page, copy: string | RegExp) {
  await expect(guidance(page)).toHaveClass(/location-lost/);
  await expect(guidance(page)).toContainText("Location lost");
  await expect(guidance(page)).toContainText(copy);
  await expect(navigating(page)).toHaveCount(0);
  await expect(page.locator(".ride-progress strong")).toHaveText("—");
}

test("[sim-device] real-route guidance accepts 25 m, refuses 26 m and 35 m with 25 m recovery copy, and a fresh 5 m fix recovers", async ({
  page,
}) => {
  await startRide(page);
  await fix(page, 40.51, -88.95, 25);
  await expect(navigating(page)).toBeVisible();
  for (const [offset, accuracy] of [
    [1_000, 26],
    [2_000, 35],
  ] as const) {
    const before = await snapshotRequests(page);
    await at(page, offset);
    await fix(page, 40.5099, -88.95, accuracy);
    // The browser refuses it before the router: the copy is the gate's, not "Route guidance is unavailable".
    await expectLost(
      page,
      "Waiting for a fresh location with accuracy within 25 m.",
    );
    await expect(guidance(page)).not.toContainText("35 m");
    expect(await snapshotRequests(page)).toBe(before);
  }
  await at(page, 3_000);
  await fix(page, 40.5098, -88.95, 5);
  await expect(navigating(page)).toBeVisible();
});

test("[sim-device] real-route guidance accepts a fix exactly 10 s old, refuses future and 11 s old fixes, and recovers", async ({
  page,
}) => {
  await startRide(page);
  // Watch started at T0; the fix taken then is delivered 10 s later. Browser and core both count 10 s as fresh,
  // and the expiry timer (which keeps ticking in real time) does not drop it at exactly 10 s.
  await at(page, 10_000);
  await fix(page, 40.51, -88.95, 5, 10_000);
  await expect(navigating(page)).toBeVisible();
  // A reading dated 1 s ahead of this device's clock is not credible to the core, so the browser refuses it too.
  const beforeFuture = await snapshotRequests(page);
  await fix(page, 40.5099, -88.95, 5, -1_000);
  await expectLost(
    page,
    "Waiting for a fresh location with accuracy within 25 m.",
  );
  expect(await snapshotRequests(page)).toBe(beforeFuture);
  await fix(page, 40.5099, -88.95, 5);
  await expect(navigating(page)).toBeVisible();
  // Nothing new for longer than 10 s: the expiry timer removes guidance.
  await at(page, 21_500);
  await expectLost(page, "Waiting for a fresh");
  // A newer, accurate reading that is already 11 s old cannot restore guidance...
  const beforeStale = await snapshotRequests(page);
  await fix(page, 40.5098, -88.95, 5, 11_000);
  await expectLost(page, "Waiting for a fresh");
  expect(await snapshotRequests(page)).toBe(beforeStale);
  // ...but one exactly 10 s old does, and stays current.
  await fix(page, 40.5097, -88.95, 5, 10_000);
  await expect(navigating(page)).toBeVisible();
  await expect(guidance(page)).not.toContainText("Location lost");
  expect(await snapshotRequests(page)).toBe(beforeStale + 1);
});

test("[sim-device] endpoint acquisition keeps the planner's 35 m / 15 s rule and its explicit approximate offer", async ({
  page,
}) => {
  await at(page, 0);
  await simulateDevice(page);
  await openPlanner(page);
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
  // Coarser than 35 m is only offered, never adopted.
  await fix(page, 40.51, -88.95, 36);
  const offer = page.getByRole("button", {
    name: "Use approximate location (within 36 m)",
    exact: true,
  });
  await expect(offer).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Start: Approx/ }),
  ).toHaveCount(0);
  // 12 s later it is too old for navigation but still a fresh endpoint offer.
  await at(page, 12_000);
  await offer.click();
  await expect(
    page.getByRole("button", {
      name: "Start: Approximate current location (within 36 m)",
      exact: true,
    }),
  ).toBeVisible();
  // A 35 m reading taken 15 s ago is a precise endpoint, though navigation would refuse it on both counts.
  await page.getByRole("button", { name: /^Destination:/ }).click();
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
  await fix(page, 40.5, -88.95, 35, 15_000);
  await expect(
    page.getByRole("button", {
      name: "Destination: Current location",
      exact: true,
    }),
  ).toBeVisible();
});
