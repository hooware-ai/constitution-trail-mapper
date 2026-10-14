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
    await audit(page, info, "waiting");
    await page.evaluate(() => (window as any).__device.fix(40.51, -88.95, 5));
    await audit(page, info, "guidance");
    await page.evaluate(() => (window as any).__device.fix(40.51, -88.95, 35));
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
