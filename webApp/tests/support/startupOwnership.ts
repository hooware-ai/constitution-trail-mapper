import { test, expect, type Page } from "@playwright/test";
import { fix, simulateDevice } from "../webkit/support";
const sessionKey = "trail-mapper.fixture:trail-mapper.web.session.v1";
const rideKey = "trail-mapper.fixture:trail-mapper.web.active-ride.v1";
const libraryKey = "trail-mapper.fixture:trail-mapper.web.library.v1";
async function delayedBoot(page: Page, planner = false) {
  await page.addInitScript(
    ({ planner, sessionKey }) => {
      if (planner && !sessionStorage.getItem("startup-seeded")) {
        localStorage.setItem(
          sessionKey,
          JSON.stringify({
            version: 1,
            screen: "planner",
            draft: {
              mode: "point",
              start: null,
              destination: null,
              miles: 5,
              proposed: false,
            },
            selected: null,
            savedTab: "saved",
            origin: "planner",
            updatedAt: Date.now(),
          }),
        );
        sessionStorage.setItem("startup-seeded", "1");
      }
      const Original = window.Worker;
      (window as any).__startupHeld = [];
      (window as any).__startupHold =
        planner || sessionStorage.getItem("startup-hold") === "1";
      window.Worker = class extends Original {
        postMessage(message: any, ...rest: any[]) {
          if (
            message?.request?.op === "boot" &&
            (window as any).__startupHold
          ) {
            (window as any).__startupHeld.push(() =>
              (super.postMessage as any)(message, ...rest),
            );
            return;
          }
          (super.postMessage as any)(message, ...rest);
        }
      } as typeof Worker;
    },
    { planner, sessionKey },
  );
}
async function release(page: Page) {
  await expect
    .poll(() => page.evaluate(() => (window as any).__startupHeld.length))
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as any).__startupHold = false;
    sessionStorage.removeItem("startup-hold");
    (window as any).__startupHeld.splice(0).forEach((run: () => void) => run());
  });
}
async function plan(page: Page) {
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  for (const [field, name] of [
    ["Start", "Review trailhead · East"],
    ["Destination", "Review trailhead · South"],
  ]) {
    await page
      .getByRole("button", { name: new RegExp("^" + field + ":") })
      .click();
    await page.getByRole("textbox", { name: "Search places" }).fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(name) })
      .click();
  }
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
}
export function startupOwnershipTests() {
  test("[engine] Back to the current home before boot cancels stale planner restoration", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      history.replaceState({ tm: 0, screen: "plan" }, "");
      history.pushState({ tm: 1, screen: "plan" }, "");
    });
    await delayedBoot(page, true);
    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => (window as any).__startupHeld.length))
      .toBeGreaterThan(0);
    await page.goBack();
    await expect.poll(() => page.evaluate(() => history.state.tm)).toBe(0);
    await release(page);
    await expect(
      page.getByRole("button", { name: /Go somewhere/ }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).screen,
          sessionKey,
        ),
      )
      .toBe("plan");
  });
  for (const leave of [false, true]) {
    test(
      leave
        ? "[engine] Home before boot completion wins over restored planner"
        : "[engine] delayed boot still restores the planner without a newer choice",
      async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await delayedBoot(page, true);
        await page.goto("/");
        await expect
          .poll(() => page.evaluate(() => (window as any).__startupHeld.length))
          .toBeGreaterThan(0);
        if (leave)
          await page
            .getByRole("button", { name: "Trail Mapper home", exact: true })
            .click();
        await release(page);
        if (leave) {
          await expect(
            page.getByRole("button", { name: /Go somewhere/ }),
          ).toBeVisible();
          await expect
            .poll(() =>
              page.evaluate(
                (key) => JSON.parse(localStorage.getItem(key)!).screen,
                sessionKey,
              ),
            )
            .toBe("plan");
        } else
          await expect(
            page.getByRole("button", { name: "Find route", exact: true }),
          ).toBeVisible();
        expect(errors).toEqual([]);
      },
    );
    test(
      leave
        ? "[sim-device] Home before boot prevents ride resume and preserves recovery bytes"
        : "[sim-device] delayed boot without a new choice restores a ride, awaiting fresh location",
      async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await simulateDevice(page);
        await delayedBoot(page);
        await page.goto("/");
        await plan(page);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page
          .getByRole("button", { name: "Start navigation", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Reacquiring location…",
            exact: true,
          }),
        ).toBeVisible();
        await fix(page, 40.51, -88.95);
        await expect(page.locator(".guidance.navigating")).toBeVisible();
        await expect(page.locator(".ride-map-canvas")).toHaveAttribute(
          "data-ready",
          "true",
        );
        const initial = await page.evaluate(
          ({ rideKey, libraryKey }) => ({
            ride: localStorage.getItem(rideKey),
            library: localStorage.getItem(libraryKey),
          }),
          { rideKey, libraryKey },
        );
        expect(initial.ride).not.toBeNull();
        await page.evaluate(() => sessionStorage.setItem("startup-hold", "1"));
        await page.reload();
        await expect
          .poll(() => page.evaluate(() => (window as any).__startupHeld.length))
          .toBeGreaterThan(0);
        // Reload legitimately checkpoints the old ride on pagehide. Compare the durable
        // bytes present after that lifecycle event, before the new Home choice.
        const before = await page.evaluate(
          ({ rideKey, libraryKey }) => ({
            ride: localStorage.getItem(rideKey),
            library: localStorage.getItem(libraryKey),
          }),
          { rideKey, libraryKey },
        );
        expect(before.ride).not.toBeNull();
        expect(before.library).toBe(initial.library);
        if (leave)
          await page
            .getByRole("button", { name: "Trail Mapper home", exact: true })
            .click();
        await release(page);
        if (leave) {
          await expect(
            page.getByRole("button", { name: /Go somewhere/ }),
          ).toBeVisible();
          await expect
            .poll(() =>
              page.evaluate(
                (key) => JSON.parse(localStorage.getItem(key)!).screen,
                sessionKey,
              ),
            )
            .toBe("plan");
          expect(
            await page.evaluate(
              ({ rideKey, libraryKey }) => ({
                ride: localStorage.getItem(rideKey),
                library: localStorage.getItem(libraryKey),
              }),
              { rideKey, libraryKey },
            ),
          ).toEqual(before);
          expect(
            await page.evaluate(() => (window as any).__device.watching()),
          ).toBe(0);
          await expect(
            page.getByRole("button", { name: "Stop navigation", exact: true }),
          ).toHaveCount(0);
          await page.reload(); // Preserved recovery remains usable when no new choice cancels restoration.
        }
        await expect(
          page.getByRole("heading", {
            name: "Reacquiring location…",
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.locator(".guidance.navigating")).toHaveCount(0);
        expect(
          await page.evaluate((key) => localStorage.getItem(key), libraryKey),
        ).toBe(before.library);
        expect(errors).toEqual([]);
      },
    );
  }
}
