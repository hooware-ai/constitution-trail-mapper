import { test, expect, type Page } from "@playwright/test";
import { choose, fix, simulateDevice, startButton } from "../webkit/support";

const ACTIVE = "trail-mapper.web.active-ride.v1";
const CARRIED = "trail-mapper.web.carried-ride.v1";
const failureMessage =
  "Your ride history could not be saved, so your current route was kept. Check browser storage and try rejoining the loop again.";

const stored = (page: Page, suffix: string) =>
  page.evaluate((suffix) => {
    const key = Object.keys(localStorage).find((key) => key.endsWith(suffix));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  }, suffix);

async function acceptedFix(page: Page, latitude: number, longitude: number) {
  const now = await page.evaluate(() => Date.now());
  await fix(page, latitude, longitude);
  await expect
    .poll(async () => (await stored(page, ACTIVE))?.updatedAt ?? 0)
    .toBeGreaterThanOrEqual(now);
}

function pointAlong(points: [number, number][], meters: number) {
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const leg =
      Math.hypot(
        (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180),
        b[0] - a[0],
      ) * 111320;
    if (travelled + leg >= meters) {
      const t = leg === 0 ? 0 : (meters - travelled) / leg;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    travelled += leg;
  }
  return points[points.length - 1];
}

async function leaveLoop(page: Page, longitude = -88.99) {
  for (const [elapsed, latitude] of [
    [1000, 40.491],
    [8000, 40.492],
    [8000, 40.493],
  ]) {
    await page.clock.fastForward(elapsed);
    await acceptedFix(page, latitude, longitude);
  }
  await expect(
    page.getByRole("heading", { name: "You are off route", exact: true }),
  ).toBeVisible();
}

// Browser adapters and selective storage quota only: the real app, worker and shared Kotlin router run unchanged.
// All route records are disposable local fixture data in Playwright's isolated browser context.
test("[sim-device] a failed carried-history write keeps the loop and progress recoverable, and a retry survives reload", async ({
  page,
}) => {
  await simulateDevice(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    (window as any).__blockCarriedHistory = true;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (
        key.endsWith("trail-mapper.web.carried-ride.v1") &&
        (window as any).__blockCarriedHistory
      )
        throw new DOMException("simulated full storage", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: "3 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await startButton(page).click();
  await expect(
    page.getByRole("heading", { name: /^Reacquiring location/ }),
  ).toBeVisible();
  const points = (await stored(page, ACTIVE)).record.route.segments
    .flatMap((segment: any) => segment.points)
    .map((point: any) => [point.latitude, point.longitude]) as [
    number,
    number,
  ][];
  await acceptedFix(page, points[0][0], points[0][1]);
  for (const meters of [80, 160, 240, 300]) {
    await page.clock.fastForward(1000);
    const [latitude, longitude] = pointAlong(points, meters);
    await acceptedFix(page, latitude, longitude);
  }
  await leaveLoop(page);
  const before = await stored(page, ACTIVE);
  expect(before.riddenMeters).toBeGreaterThan(200);
  expect(before.riddenMeters).toBeLessThan(320);
  await page
    .getByRole("button", { name: "Rejoin the loop", exact: true })
    .click();
  await expect(page.getByText(failureMessage, { exact: true })).toBeVisible();
  expect(await stored(page, ACTIVE)).toEqual(before);
  expect(await stored(page, CARRIED)).toBeNull();
  await expect(
    page.getByRole("heading", { name: "You are off route", exact: true }),
  ).toBeVisible();

  // A reload after the failed rejoin must recover the original route and its ridden distance.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /^Reacquiring location/ }),
  ).toBeVisible();
  const recovered = await stored(page, ACTIVE);
  expect(recovered.record.key).toBe(before.record.key);
  expect(recovered.riddenMeters).toBe(before.riddenMeters);
  expect(recovered.creditedDistanceMeters).toBe(before.creditedDistanceMeters);

  // Storage recovers: the same loop can rejoin, persist its carried history, and resume the replacement after reload.
  await page.evaluate(() => ((window as any).__blockCarriedHistory = false));
  await page.clock.fastForward(1000);
  const [latitude, longitude] = pointAlong(points, 300);
  await acceptedFix(page, latitude, longitude);
  await leaveLoop(page);
  await page
    .getByRole("button", { name: "Rejoin the loop", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Reacquiring location/ }),
  ).toBeVisible();
  const carried = await stored(page, CARRIED);
  const replacement = await stored(page, ACTIVE);
  expect(replacement.record.key).not.toBe(before.record.key);
  expect(carried.recordKey).toBe(replacement.record.key);
  expect(carried.carried.distanceMeters).toBeGreaterThan(200);
  expect(carried.carried.distanceMeters).toBeLessThan(320);
  expect(carried.carried.traversalEdges.length).toBeGreaterThan(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /^Reacquiring location/ }),
  ).toBeVisible();
  expect((await stored(page, ACTIVE)).record.key).toBe(replacement.record.key);
  expect(await stored(page, CARRIED)).toEqual(carried);
});

async function rideMeters(page: Page, meters: number[]) {
  const points = (await stored(page, ACTIVE)).record.route.segments
    .flatMap((segment: any) => segment.points)
    .map((point: any) => [point.latitude, point.longitude]) as [
    number,
    number,
  ][];
  for (const distance of meters) {
    await page.clock.fastForward(1000);
    const [latitude, longitude] = pointAlong(points, distance);
    await acceptedFix(page, latitude, longitude);
  }
}

test("[sim-device] a second rejoin with an active-ride save failure keeps the previous loop's history recoverable", async ({
  page,
}) => {
  await simulateDevice(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    (window as any).__blockActiveRide = false;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (
        key.endsWith("trail-mapper.web.active-ride.v1") &&
        (window as any).__blockActiveRide
      )
        throw new DOMException("simulated full storage", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead \u00b7 East");
  await page.getByRole("button", { name: "3 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await startButton(page).click();
  await expect(
    page.getByRole("heading", { name: /^Reacquiring location/ }),
  ).toBeVisible();
  await rideMeters(page, [0, 80, 160, 240, 300]);
  await leaveLoop(page);
  await page
    .getByRole("button", { name: "Rejoin the loop", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Reacquiring location/ }),
  ).toBeVisible();
  const firstCarry = await stored(page, CARRIED);
  expect(firstCarry.carried.distanceMeters).toBeGreaterThan(200);

  // Ride some of the replacement, then fail only its next active-ride save; carried-history writes still succeed.
  await rideMeters(page, [0, 80, 160, 240, 300]);
  await leaveLoop(page, -88.985);
  const recoverable = await stored(page, ACTIVE);
  expect(recoverable.record.key).toBe(firstCarry.recordKey);
  const expectedDistance =
    firstCarry.carried.distanceMeters + recoverable.riddenMeters;
  await page.evaluate(() => ((window as any).__blockActiveRide = true));
  await page
    .getByRole("button", { name: "Rejoin the loop", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Reacquiring location/ }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Your ride could not be saved for recovery. Keep this page open.",
    ),
  ).toBeVisible();
  expect(await stored(page, ACTIVE)).toEqual(recoverable);
  expect((await stored(page, CARRIED)).recordKey).not.toBe(
    recoverable.record.key,
  );

  // Reload restores the previous active route. Rejoining it must include the history from before its first rejoin.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /^Reacquiring location/ }),
  ).toBeVisible();
  expect((await stored(page, ACTIVE)).record.key).toBe(recoverable.record.key);
  await rideMeters(page, [recoverable.riddenMeters]);
  await leaveLoop(page, -88.975);
  await page
    .getByRole("button", { name: "Rejoin the loop", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Reacquiring location/ }),
  ).toBeVisible();
  const afterReloadCarry = await stored(page, CARRIED);
  expect(afterReloadCarry.carried.distanceMeters).toBeGreaterThan(
    expectedDistance - 30,
  );
  expect(afterReloadCarry.carried.distanceMeters).toBeLessThan(
    expectedDistance + 30,
  );
});
