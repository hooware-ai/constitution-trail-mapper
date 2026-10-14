import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import { planPoint, simulateDevice } from "../webkit/support";
const variants = [
  ["light", 390, 844, "100%"],
  ["dark", 390, 844, "100%"],
  ["light", 640, 320, "150%"],
  ["dark", 640, 320, "150%"],
  ["light", 320, 640, "200%"],
  ["dark", 320, 640, "200%"],
] as const;
async function assertRideToolsReachable(page: Page) {
  for (const selector of [
    ".ride-map-tools .ride-credit",
    ".ride-map-tools .ride-map-control button",
  ]) {
    const item = page.locator(selector).first();
    await expect(item).toBeVisible();
    await item.scrollIntoViewIfNeeded();
    expect(
      await item.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        return Boolean(hit && e.contains(hit));
      }),
      selector + " is reachable without another overlay covering it",
    ).toBe(true);
  }
  await expect(
    page.getByRole("button", { name: "Stop navigation", exact: true }),
  ).toBeVisible();
}

async function audit(page: Page, info: TestInfo, name: string) {
  const dialog = page.locator("dialog[open]");
  const builder = new AxeBuilder({ page }).withRules(["color-contrast"]);
  if (await dialog.count()) builder.include("dialog[open]");
  const result = await builder.analyze();
  await writeFile(
    info.outputPath(name + ".json"),
    JSON.stringify(
      {
        scope:
          "text contrast only; incomplete findings require manual assessment",
        violations: result.violations,
        incomplete: result.incomplete,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath(name + ".png") });
  expect(
    result.violations.map((x) => ({
      id: x.id,
      nodes: x.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
}
for (const [scheme, width, height, font] of variants) {
  test(`${scheme} ${width}x${height} ${font}: home, planner, chooser, Saved, Explore, Updates and Help contrast`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.getByRole("button", { name: /Go somewhere/ }).waitFor();
    await page.evaluate(
      (size) => (document.documentElement.style.fontSize = size),
      font,
    );
    await audit(page, info, "home");
    await page.getByRole("button", { name: /Go somewhere/ }).click();
    await audit(page, info, "planner");
    await page.getByRole("button", { name: /^Start:/ }).click();
    await audit(page, info, "chooser");
    await page.getByRole("button", { name: /Close Choose/ }).click();
    await page
      .getByRole("button", { name: "Trail Mapper home", exact: true })
      .click();
    for (const name of ["Saved", "Explore", "Updates"]) {
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name, exact: true })
        .click();
      await audit(page, info, name.toLowerCase());
    }
    await page
      .getByRole("button", { name: "Help and about", exact: true })
      .click();
    await audit(page, info, "help");
  });
  test(`${scheme} ${width}x${height} ${font}: real-route preview, Directions and Share contrast`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height });
    await planPoint(page);
    await page.evaluate(
      (size) => (document.documentElement.style.fontSize = size),
      font,
    );
    await audit(page, info, "preview");
    await page.getByRole("button", { name: "Directions", exact: true }).click();
    await audit(page, info, "directions");
    await page
      .getByRole("button", { name: "Close Directions", exact: true })
      .click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await audit(page, info, "share");
  });
  test(`${scheme} ${width}x${height} ${font}: simulated-device waiting, live and lost guidance contrast`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height });
    await simulateDevice(page);
    await planPoint(page);
    await page.evaluate(
      (size) => (document.documentElement.style.fontSize = size),
      font,
    );
    await page
      .getByRole("button", { name: "Start navigation", exact: true })
      .click();
    await assertRideToolsReachable(page);
    await audit(page, info, "waiting");
    await page.evaluate(() => (window as any).__device.fix(40.51, -88.95, 5));
    await assertRideToolsReachable(page);
    await audit(page, info, "guidance");
    await page.evaluate(() => (window as any).__device.fix(40.51, -88.95, 35));
    await assertRideToolsReachable(page);
    await audit(page, info, "lost");
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme}: navigation selection, hover, keyboard focus and theme toggle preserve a real preview`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByRole("button", { name: /Go somewhere/ }).waitFor();
    const preview = page.getByRole("button", {
      name: "Start navigation",
      exact: true,
    });

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const selected = nav.locator('[aria-current="page"]');
    await expect(selected).toHaveCount(1);
    const measurements = await selected.evaluate((element) => {
      function luminance(rgb: string) {
        const channels = rgb
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((x) => {
            const v = x / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      }
      const s = getComputedStyle(element);
      const a = luminance(s.color),
        b = luminance(s.backgroundColor);
      return {
        color: s.color,
        background: s.backgroundColor,
        shadow: s.boxShadow,
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
    expect(measurements.contrast).toBeGreaterThanOrEqual(4.5);
    expect(measurements.shadow).toContain("inset");
    expect(measurements.shadow).toContain("-3px");
    await selected.hover();
    await audit(page, info, "hover-preview");
    await selected.focus();
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus-visible");
    await expect(focused).toHaveCount(1);
    const focus = await focused.evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        color: s.outlineColor,
        width: s.outlineWidth,
        style: s.outlineStyle,
      };
    });
    expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
    expect(focus.style).not.toBe("none");
    await audit(page, info, "keyboard-focus-preview");
    await planPoint(page);
    await expect(preview).toBeVisible();
    const initial = await page
      .locator("html")
      .evaluate((e) => getComputedStyle(e).backgroundColor);
    await page.emulateMedia({
      colorScheme: scheme === "dark" ? "light" : "dark",
    });
    await expect(preview).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("html")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
      )
      .not.toBe(initial);
    await audit(page, info, "toggle-preserved-preview");
    await writeFile(
      info.outputPath("state-measurements.json"),
      JSON.stringify(
        {
          measurements,
          focus,
          scope:
            "CSS selection/focus and live browser toggle; no OS system-bar claim",
        },
        null,
        2,
      ),
    );
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme}: standalone adapter retains themed Help and measurable chooser input boundaries`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = original(query);
        if (query === "(display-mode: standalone)")
          Object.defineProperty(result, "matches", { value: true });
        return result;
      };
    });
    await page.goto("/");
    const attribution = page.locator(".leaflet-control-attribution");
    await expect(attribution).toBeVisible();
    await expect(attribution).toHaveCSS(
      "background-color",
      "rgb(246, 250, 248)",
    );
    await expect(attribution).toHaveCSS("color", "rgb(21, 62, 53)");
    await expect(attribution.locator("a").first()).toHaveCSS(
      "color",
      "rgb(7, 92, 77)",
    );
    // Startup focuses the main heading on the next animation frame after network adoption.
    await expect(
      page.getByRole("heading", { name: "Plan a ride", exact: true }),
    ).toBeFocused();
    const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
    await zoom.focus();
    await expect(zoom).toBeFocused();
    await expect(zoom).toHaveCSS(
      "color",
      scheme === "dark" ? "rgb(227, 243, 234)" : "rgb(0, 0, 0)",
    );
    if (scheme === "dark")
      await expect(zoom).toHaveCSS("background-color", "rgb(43, 70, 55)");
    await audit(page, info, "focused-zoom-and-attribution");
    await page.getByRole("button", { name: /Go somewhere/ }).click();
    await page.getByRole("button", { name: /^Start:/ }).click();
    const input = page.getByRole("textbox", {
      name: "Search places",
      exact: true,
    });
    await expect(input).toBeVisible();
    const boundary = await input.evaluate((e) => {
      const s = getComputedStyle(e);
      function luminance(rgb: string) {
        const v = rgb
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((x) => {
            const c = x / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
      }
      const a = luminance(s.borderTopColor),
        b = luminance(s.backgroundColor);
      return {
        border: s.borderTopColor,
        background: s.backgroundColor,
        width: s.borderTopWidth,
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
    expect(parseFloat(boundary.width)).toBeGreaterThan(0);
    expect(boundary.contrast).toBeGreaterThanOrEqual(3);
    await audit(page, info, "standalone-adapter-chooser");
    await page.getByRole("button", { name: /Close Choose/ }).click();
    await page
      .getByRole("button", { name: "Help and about", exact: true })
      .click();
    await audit(page, info, "standalone-adapter-help");
    await writeFile(
      info.outputPath("input-boundary.json"),
      JSON.stringify(
        {
          ...boundary,
          scope:
            "browser display-mode adapter; not installed PWA or OS navigation icons",
        },
        null,
        2,
      ),
    );
  });
}

test("Chromium forced-colors: focused current navigation has a distinct outward focus outline", async ({
  page,
  browserName,
}, info) => {
  test.skip(
    browserName !== "chromium",
    "WebKit does not emulate Windows forced-colors acceptance",
  );
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).waitFor();
  const selected = page
    .getByRole("navigation", { name: "Main navigation" })
    .locator('[aria-current="page"]');
  await expect(selected).toHaveCSS("outline-offset", "-3px");
  await page.keyboard.press("Tab");
  await selected.focus();
  await expect(selected).toHaveCSS("outline-offset", "3px");
  await expect(selected).toHaveCSS("outline-width", "3px");
  await page.screenshot({
    path: info.outputPath("forced-colors-focused-current.png"),
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme}: pressed distance preset remains distinct`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.getByRole("button", { name: /Make an exercise loop/ }).click();
    const preset = page.getByRole("button", { name: "8 mi", exact: true });
    await preset.click();
    await expect(preset).toHaveAttribute("aria-pressed", "true");
    if (scheme === "dark") {
      await expect(preset).toHaveCSS("border-top-color", "rgb(143, 221, 191)");
      expect(
        await preset.evaluate((e) => getComputedStyle(e).boxShadow),
      ).toContain("inset");
    } else
      await expect(preset).toHaveCSS("border-top-color", "rgb(8, 114, 95)");
  });
}

test("dark: real map minimum zoom remains visibly disabled", async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).waitFor();
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  for (
    let i = 0;
    i < 25 && (await zoomOut.getAttribute("aria-disabled")) !== "true";
    i++
  ) {
    await zoomOut.click();
  }
  await expect(zoomOut).toHaveAttribute("aria-disabled", "true");
  await zoomOut.evaluate((e) => (e as HTMLElement).blur());
  await expect(zoomOut).toHaveCSS("opacity", "0.55");
  await expect(zoomOut).toHaveCSS("color", "rgb(185, 206, 194)");
  await page.keyboard.press("Tab");
  await zoomOut.focus();
  await expect(zoomOut).toHaveCSS("opacity", "1");
  await expect(zoomOut).toHaveCSS("outline-width", "3px");
  await page.screenshot({ path: info.outputPath("disabled-zoom.png") });
});
