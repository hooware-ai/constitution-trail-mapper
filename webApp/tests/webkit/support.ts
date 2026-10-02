// Shared helpers for the WebKit launch-acceptance specs (issue #41).
//
// Evidence labels used in test titles, so a reader can tell what each result actually proves:
//   [engine]      the real WebKit engine running the real app, worker and Kotlin router; no simulated device API
//   [engine-geo]  the engine's own geolocation API fed by the test harness (a simulated provider, not a GPS)
//   [sim-device]  a deterministic adapter replaces navigator.geolocation / visibility / wake lock so interruptions can be
//                 scripted exactly. This tests the app's behavior, NOT iOS or Android behavior.
// None of these is physical-device, OS permission, lock-screen, VoiceOver or TalkBack acceptance (see
// docs/web/launch-acceptance.md).
import { expect, type Page } from "@playwright/test";

export interface SimulationOptions {
  /** How a wake-lock request is answered: granted, refused, or no API at all (as on an older Safari). */
  wakeLock?: "grant" | "deny" | "absent";
}

/** Installs the scripted browser adapters. Call before page.goto(). */
export async function simulateDevice(
  page: Page,
  options: SimulationOptions = {},
) {
  await page.addInitScript((wake) => {
    let id = 0;
    let visible = true;
    const watches = new Map<
      number,
      { success: PositionCallback; error?: PositionErrorCallback | null }
    >();
    Object.defineProperty(document, "visibilityState", {
      get: () => (visible ? "visible" : "hidden"),
    });
    Object.defineProperty(document, "hidden", { get: () => !visible });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition(
          success: PositionCallback,
          error?: PositionErrorCallback,
        ) {
          watches.set(++id, { success, error });
          return id;
        },
        clearWatch(key: number) {
          watches.delete(key);
        },
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: { latitude: 40.51, longitude: -88.95, accuracy: 5 },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
    const sentinels: Array<{ released: boolean; fire: () => void }> = [];
    let requests = 0;
    if (wake === "absent") {
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: undefined,
      });
    } else {
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: {
          async request() {
            requests++;
            if (wake === "deny")
              throw new DOMException("denied", "NotAllowedError");
            const listeners: Array<() => void> = [];
            const sentinel = {
              released: false,
              addEventListener(_type: string, cb: () => void) {
                listeners.push(cb);
              },
              async release() {
                sentinel.released = true;
              },
              fire() {
                sentinel.released = true;
                listeners.forEach((cb) => cb());
              },
            };
            sentinels.push(sentinel);
            return sentinel;
          },
        },
      });
    }
    (window as any).__device = {
      fix(latitude: number, longitude: number, accuracy = 5, age = 0) {
        for (const watch of watches.values())
          watch.success({
            coords: { latitude, longitude, accuracy },
            timestamp: Date.now() - age,
          } as GeolocationPosition);
      },
      fail(code: number) {
        for (const watch of watches.values())
          watch.error?.({
            code,
            message: "simulated",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
      },
      visible(value: boolean) {
        visible = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      watching: () => watches.size,
      wakeRequests: () => requests,
      wakeActive: () => sentinels.filter((s) => !s.released).length,
      /** The browser takes the screen lock back (as it does when the page is hidden). */
      releaseWake: () => sentinels.forEach((s) => !s.released && s.fire()),
    };
  }, options.wakeLock ?? "grant");
}

export const fix = (
  page: Page,
  lat: number,
  lon: number,
  accuracy = 5,
  age = 0,
) =>
  page.evaluate(
    (a) => (window as any).__device.fix(a.lat, a.lon, a.accuracy, a.age),
    {
      lat,
      lon,
      accuracy,
      age,
    },
  );
export const setVisible = (page: Page, visible: boolean) =>
  page.evaluate((v) => (window as any).__device.visible(v), visible);

export async function choose(
  page: Page,
  field: "Start" | "Destination",
  name: string,
) {
  await page
    .getByRole("button", { name: new RegExp("^" + field + ":") })
    .click();
  await page.getByRole("textbox", { name: "Search places" }).fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(name) })
    .click();
}

/** First visit: opens the app and starts the point-to-point planner. */
export async function openPlanner(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
}

export async function planPoint(page: Page) {
  await openPlanner(page);
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
}

/** Starts from the browser's current location (the simulated adapter reports `latitude`) to the East trailhead. */
export async function planFromCurrentLocation(page: Page) {
  await openPlanner(page);
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page
    .getByRole("button", { name: "Use current location", exact: true })
    .click();
}

export const startButton = (page: Page) =>
  page.getByRole("button", { name: "Start navigation", exact: true });

/** No horizontal scrolling: the page is never wider than the screen. */
export const fitsWidth = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
