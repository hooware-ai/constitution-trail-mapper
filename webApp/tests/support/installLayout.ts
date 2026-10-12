import { test, expect, type Locator, type Page } from "@playwright/test";
import { simulateDevice } from "../webkit/support";

async function containedText(button: Locator) {
  const box = await button.evaluate((element) => {
    const label = element.querySelector(".install-label") ?? element;
    const range = document.createRange();
    range.selectNodeContents(label);
    const rect = element.getBoundingClientRect();
    const text = [...range.getClientRects()].filter((r) => r.width && r.height);
    return {
      width: rect.width,
      height: rect.height,
      inButton:
        text.length > 0 &&
        text.every(
          (r) =>
            r.left >= rect.left &&
            r.right <= rect.right &&
            r.top >= rect.top &&
            r.bottom <= rect.bottom,
        ),
      inViewport: rect.left >= 0 && rect.right <= innerWidth,
    };
  });
  expect(box.inButton).toBe(true);
  expect(box.inViewport).toBe(true);
  expect(box.height).toBeGreaterThanOrEqual(48);
  return { width: box.width, height: box.height };
}

async function planPoint(page: Page) {
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
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
}

export function installLayoutTests() {
  test("[engine] an oversized preview dock flows without covering the map, actions or blocked reason", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await simulateDevice(page);
    await page.goto("/");
    await planPoint(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
    await page.addStyleTag({
      content: "* { letter-spacing: 0.4em !important; }",
    });
    const dock = page.locator(".start-dock");
    await expect(dock).toHaveAttribute("data-flow", "");
    await expect(dock).toHaveCSS("position", "static");
    await page.evaluate(() => scrollTo(0, 0));
    expect(
      await page.evaluate(() => {
        const map = document.querySelector(".map")!.getBoundingClientRect(),
          dock = document.querySelector(".start-dock")!.getBoundingClientRect();
        return map.bottom <= dock.top;
      }),
    ).toBe(true);
    await page.getByRole("button", { name: "Directions", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Directions" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.context().setOffline(true);
    const start = page.getByRole("button", {
      name: "Start navigation",
      exact: true,
    });
    await expect(start).toBeDisabled();
    const reason = dock.locator(".start-reason");
    await expect(reason).toBeVisible();
    await reason.scrollIntoViewIfNeeded();
    expect(
      await reason.evaluate(
        (element) => element.scrollHeight <= element.clientHeight,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(dock).toHaveAttribute("data-flow", "");
    await expect(dock).toHaveCSS("position", "static");
    await page.getByRole("button", { name: "Directions", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Directions" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.context().setOffline(false);
    await expect(start).toBeEnabled();
    await page.setViewportSize({ width: 320, height: 1600 });
    const geometry = await page.evaluate(() => ({
      dockHeight: document.querySelector(".start-dock")!.getBoundingClientRect()
        .height,
      mapBottom:
        document.querySelector(".map")!.getBoundingClientRect().bottom +
        scrollY,
      headerHeight: document.querySelector("header")!.getBoundingClientRect()
        .height,
      viewport: innerHeight,
    }));
    await expect(dock, JSON.stringify(geometry)).not.toHaveAttribute(
      "data-flow",
      "",
    );
    await expect(dock).toHaveCSS("position", "fixed");
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(dock).toHaveAttribute("data-flow", "");
    const help = dock.getByRole("button", {
      name: "Help and about",
      exact: true,
    });
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
  });
  for (const view of [
    { width: 320, height: 720 },
    { width: 640, height: 320 },
  ]) {
    test(`[engine] all Install states keep their text inside a stable 200% target at ${view.width}x${view.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(view);
      await page.clock.install();
      await page.addInitScript(() => {
        const w = window as any;
        Object.defineProperty(navigator, "userAgent", {
          configurable: true,
          value: "Mozilla/5.0 (Linux; Android 16) Chrome/154.0.0.0 Mobile",
        });
        Object.defineProperty(navigator, "getInstalledRelatedApps", {
          configurable: true,
          value: () => new Promise(() => {}),
        });
        w.layoutPrompt = () => {
          const event = new Event("beforeinstallprompt", {
            cancelable: true,
          }) as any;
          event.prompt = () =>
            new Promise<void>((resolve) => {
              w.finishLayoutPrompt = resolve;
            });
          event.userChoice = Promise.resolve({ outcome: "dismissed" });
          window.dispatchEvent(event);
        };
      });
      await page.goto("/");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      const button = page.locator(".install-button");
      await expect(button).toHaveText("Checking…");
      const size = await containedText(button);
      await page.evaluate(() => (window as any).layoutPrompt());
      await expect(button).toHaveText("Install");
      expect(await containedText(button)).toEqual(size);
      await button.click();
      await expect(button).toHaveText("Installing…");
      expect(await containedText(button)).toEqual(size);
      await page.evaluate(() => {
        (window as any).finishLayoutPrompt();
        window.dispatchEvent(new Event("appinstalled"));
      });
      await expect(button).toHaveText("Open");
      expect(await containedText(button)).toEqual(size);
      await button.click({ trial: true });
      const brand = await page.locator(".app-header .brand").boundingBox();
      const action = await button.boundingBox();
      expect(
        Math.min(brand!.x + brand!.width, action!.x + action!.width) >
          Math.max(brand!.x, action!.x) &&
          Math.min(brand!.y + brand!.height, action!.y + action!.height) >
            Math.max(brand!.y, action!.y),
      ).toBe(false);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }

  test("[engine] Help returns focus to its replacement dock opener after held preview inspection", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const Original = window.Worker,
        w = window as any;
      w.helpHeld = [];
      w.helpHold = sessionStorage.getItem("help-hold-inspect") === "1";
      window.Worker = class extends Original {
        postMessage(message: any, ...rest: any[]) {
          if (message?.request?.op === "inspect" && w.helpHold) {
            w.helpHeld.push(() => (super.postMessage as any)(message, ...rest));
          } else (super.postMessage as any)(message, ...rest);
        }
      } as typeof Worker;
    });
    await page.goto("/");
    await planPoint(page);
    await page.evaluate(() => sessionStorage.setItem("help-hold-inspect", "1"));
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => (window as any).helpHeld.length))
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("heading", { name: "Route preview", exact: true }),
    ).toBeFocused();
    const opener = page
      .locator(".help-only-nav")
      .getByRole("button", { name: "Help and about", exact: true });
    await opener.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Help and about" }),
    ).toBeVisible();
    await page.evaluate(() => {
      const w = window as any;
      w.helpHold = false;
      sessionStorage.removeItem("help-hold-inspect");
      w.helpHeld.splice(0).forEach((run: () => void) => run());
    });
    await expect(page.locator(".start-dock-help")).toHaveCount(1);
    await expect(opener).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".start-dock-help")).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Start navigation", exact: true }),
    ).toBeEnabled();
  });
}
