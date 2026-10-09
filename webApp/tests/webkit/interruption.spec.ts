// Foreground interruption and recovery on WebKit (issue #41). Every test here is [sim-device]: a deterministic adapter
// replaces navigator.geolocation, page visibility and the Screen Wake Lock API so each interruption happens exactly when
// the test says. They prove what the APP does when the browser reports these events on the WebKit engine. They do NOT prove
// what iPhone Safari, iOS, a lock screen or a real GPS does: that is the operator checklist in docs/web/launch-acceptance.md.
import { test, expect, type Page } from "@playwright/test";
import {
  fix,
  planPoint,
  setVisible,
  simulateDevice,
  startButton,
} from "./support";

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  (page as any).__errors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as any).__errors).toEqual([]);
});

const heading = (page: Page, name: string) =>
  page.getByRole("heading", { name, exact: true });
const guidance = (page: Page) => page.locator(".guidance.navigating");
const wakeStatus = (page: Page) => page.locator(".wake-status");

async function ride(
  page: Page,
  wakeLock: "grant" | "deny" | "absent" = "grant",
) {
  await simulateDevice(page, { wakeLock });
  await planPoint(page);
  await startButton(page).click();
  await expect(heading(page, "Reacquiring location…")).toBeVisible();
}
async function riding(
  page: Page,
  wakeLock: "grant" | "deny" | "absent" = "grant",
) {
  await ride(page, wakeLock);
  await fix(page, 40.51, -88.95);
  await expect(guidance(page)).toBeVisible();
  await expect(page.locator(".ride-map-canvas")).toBeVisible();
}

async function openRideDetails(page: Page) {
  await page.locator(".ride-details summary").click();
}

test("[sim-device] starting navigation says it is waiting for a fresh fix, then guides once one arrives, and holds the screen awake", async ({
  page,
}) => {
  await ride(page);
  await expect(guidance(page)).not.toBeVisible();
  await fix(page, 40.51, -88.95);
  await expect(guidance(page)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__device.wakeActive()))
    .toBe(1);
  expect(
    await page.evaluate(() => (window as any).__device.wakeRequests()),
  ).toBe(1);
  await openRideDetails(page);
  await expect(
    page.getByText(/Guidance pauses if the screen locks/),
  ).toBeVisible();
});

test("[sim-device] hiding the page pauses guidance and releases the wake lock; coming back asks for a fresh fix and takes the lock again", async ({
  page,
}) => {
  await riding(page);
  await setVisible(page, false);
  await expect(heading(page, "Navigation paused")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__device.wakeActive())).toBe(
    0,
  );
  await setVisible(page, true);
  await expect(heading(page, "Reacquiring location…")).toBeVisible();
  // Guidance does not come back on its own: only a fresh, accurate fix restores it.
  await expect(guidance(page)).not.toBeVisible();
  await fix(page, 40.505, -88.95, 150); // too inaccurate
  await expect(heading(page, "Location lost")).toBeVisible();
  await fix(page, 40.505, -88.95, 5, 60000); // too old
  await expect(guidance(page)).not.toBeVisible();
  await fix(page, 40.505, -88.95);
  await expect(guidance(page)).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__device.wakeRequests()),
  ).toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => page.evaluate(() => (window as any).__device.wakeActive()))
    .toBe(1);
});

test("[sim-device] distance travelled while the page was hidden is not credited", async ({
  page,
}) => {
  await riding(page);
  await openRideDetails(page);
  await expect(page.getByText(/0\.0 mi observed this ride/)).toBeVisible();
  await setVisible(page, false);
  await setVisible(page, true);
  // The rider came back some distance along the route: that gap was never observed.
  await fix(page, 40.5, -88.95);
  await expect(guidance(page)).toBeVisible();
  await expect(page.getByText(/0\.0 mi observed this ride/)).toBeVisible();
});

test("[sim-device] a reload during a settled ride keeps the ride, shows no stale guidance, and resumes only after a fresh fix", async ({
  page,
}) => {
  await riding(page);
  // Exercise a fully loaded ride. Reloading while Vite worker imports are still starting
  // can cancel the old document's module requests before the map load event.
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.reload();
  await expect(heading(page, "Reacquiring location…")).toBeVisible();
  await expect(guidance(page)).not.toBeVisible();
  await fix(page, 40.502, -88.95);
  await expect(guidance(page)).toBeVisible();
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  // The ride lives in this browser's storage, and survives the engine's storage rules.
  const stored = await page.evaluate(() =>
    Object.keys(localStorage).some((key) =>
      key.endsWith("trail-mapper.web.active-ride.v1"),
    ),
  );
  expect(stored).toBe(true);
});

test("[sim-device] losing and regaining the network is stated, guidance waits for location, and Stop returns to the preview", async ({
  page,
  context,
}) => {
  await riding(page);
  // The canvas mounts before MapLibre's module worker finishes loading.
  // Take the browser offline only after the real map load event, not a timer.
  await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await context.setOffline(true);
  await expect(page.locator(".ride-offline")).toBeVisible();
  await page.evaluate(() => (window as any).__device.fail(2));
  await expect(heading(page, "Location lost")).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator(".ride-offline")).not.toBeVisible();
  await fix(page, 40.505, -88.95);
  await expect(guidance(page)).toBeVisible();
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  await expect(heading(page, "Route preview")).toBeVisible();
});

test("[sim-device] location lost mid-ride hides guidance at once and recovers on the next good fix", async ({
  page,
}) => {
  await riding(page);
  await page.evaluate(() => (window as any).__device.fail(2));
  await expect(heading(page, "Location lost")).toBeVisible();
  await expect(guidance(page)).not.toBeVisible();
  await fix(page, 40.505, -88.95);
  await expect(guidance(page)).toBeVisible();
});

test("[sim-device] location permission denied when navigation starts is explained, and the route and directions stay usable", async ({
  page,
}) => {
  await ride(page);
  await page.evaluate(() => (window as any).__device.fail(1));
  await openRideDetails(page);
  await expect(
    page.getByText(/Allow location in browser settings/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Directions", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  await expect(heading(page, "Route preview")).toBeVisible();
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Directions" })).toBeVisible();
});

test("[sim-device] a refused wake lock is stated and the ride carries on", async ({
  page,
}) => {
  await riding(page, "deny");
  await openRideDetails(page);
  await expect(wakeStatus(page)).toContainText("wake lock denied");
  await fix(page, 40.505, -88.95);
  await expect(guidance(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop navigation", exact: true }),
  ).toBeEnabled();
  // Denial does not retry in a loop.
  expect(
    await page.evaluate(() => (window as any).__device.wakeRequests()),
  ).toBeLessThanOrEqual(2);
});

test("[sim-device] a browser with no wake lock API (an older Safari) says so and navigation still works", async ({
  page,
}) => {
  await riding(page, "absent");
  await openRideDetails(page);
  await expect(wakeStatus(page)).toContainText("wake lock unsupported");
  await fix(page, 40.505, -88.95);
  await expect(guidance(page)).toBeVisible();
});

test("[sim-device] the browser taking the wake lock back is stated and does not stop guidance", async ({
  page,
}) => {
  await riding(page);
  await page.evaluate(() => (window as any).__device.releaseWake());
  await openRideDetails(page);
  await expect(wakeStatus(page)).toContainText("wake lock released");
  await fix(page, 40.505, -88.95);
  await expect(guidance(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop navigation", exact: true }),
  ).toBeEnabled();
});

test("[sim-device] navigation never claims background tracking, alerts or recording", async ({
  page,
}) => {
  await riding(page);
  const body = page.locator("body");
  await expect(body).not.toContainText(
    /background (tracking|navigation) (is )?(on|active|enabled)/i,
  );
  await expect(body).not.toContainText(/we('ll| will) (alert|notify|record)/i);
});
