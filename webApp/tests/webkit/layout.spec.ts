// Layout, large text, keyboard and automated accessibility checks on WebKit (issue #41). These run on the desktop engine and
// on iPhone-sized viewports (touch emulation, no real device). axe is an automated check, NOT VoiceOver: assistive-technology
// use is on the operator checklist in docs/web/launch-acceptance.md.
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import {
  choose,
  fitsWidth,
  openPlanner,
  planPoint,
  startButton,
} from "./support";

const tabs = ["Plan", "Saved", "Explore", "Updates"];
const nav = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("button", { name, exact: true });

test("[engine] no screen needs sideways scrolling, at normal and at 150% text", async ({
  page,
}) => {
  await page.goto("/");
  for (const larger of [false, true]) {
    if (larger)
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "24px"),
      );
    for (const tab of tabs) {
      await nav(page, tab).click();
      expect(
        await fitsWidth(page),
        `${tab}${larger ? " (150% text)" : ""}`,
      ).toBe(true);
    }
    await page.getByRole("button", { name: /^Help/ }).first().click();
    await expect(
      page.getByRole("dialog", { name: "Help and about" }),
    ).toBeVisible();
    expect(await fitsWidth(page), `Help${larger ? " (150% text)" : ""}`).toBe(
      true,
    );
    await page.keyboard.press("Escape");
  }
});

test("[engine] the route preview and its dialogs fit the screen and the map keeps a usable size", async ({
  page,
}) => {
  await planPoint(page);
  expect(await fitsWidth(page)).toBe(true);
  const map = await page
    .getByRole("region", { name: "Complete route map" })
    .boundingBox();
  expect(map?.width ?? 0).toBeGreaterThan(200);
  expect(map?.height ?? 0).toBeGreaterThan(120);
  await page.evaluate(() => (document.documentElement.style.fontSize = "24px"));
  expect(await fitsWidth(page)).toBe(true);
  await expect(startButton(page)).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share route" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const view = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(view.width + 1);
});

test("[engine] the map picker keeps a usable map on this screen", async ({
  page,
}) => {
  await openPlanner(page);
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page.getByRole("button", { name: "Pick on map", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use map center" }),
  ).toBeVisible();
  const map = await page
    .getByRole("region", { name: "Trail network map", exact: true })
    .boundingBox();
  expect(map?.width ?? 0).toBeGreaterThan(250);
  expect(map?.height ?? 0).toBeGreaterThan(150);
  expect(await fitsWidth(page)).toBe(true);
});

test("[engine] the primary controls are large enough to touch on a phone", async ({
  page,
}, info) => {
  test.skip(
    !info.project.name.includes("iphone"),
    "touch size matters on the phone projects",
  );
  await page.goto("/");
  const targets = [
    page.getByRole("button", { name: /Go somewhere/ }),
    page.getByRole("button", { name: /Make an exercise loop/ }),
    nav(page, "Plan"),
    nav(page, "Saved"),
    nav(page, "Explore"),
    nav(page, "Updates"),
  ];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box, "target is on screen").not.toBeNull();
    // 44 CSS pixels is Apple's minimum touch target; WCAG 2.2 AA asks for 24.
    expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
  }
  await planPoint(page);
  for (const name of ["Start navigation", "Save", "Share", "Directions"]) {
    const box = await page
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(box, name).not.toBeNull();
    expect(Math.min(box!.width, box!.height), name).toBeGreaterThanOrEqual(44);
  }
});

test("[engine] keyboard: the planner can be completed without a pointer, dialogs return focus, Escape closes them", async ({
  page,
}) => {
  await openPlanner(page);
  const start = page.getByRole("button", { name: /^Start:/ });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  // Focus lands inside the dialog (on its Close button, as in Chromium); Tab reaches the search box.
  const search = page.getByRole("textbox", { name: "Search places" });
  for (
    let step = 0;
    step < 6 && !(await search.evaluate((el) => el === document.activeElement));
    step++
  )
    await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await page.keyboard.type("Review trailhead · East");
  // Tab reaches the matching place within a few presses; Enter chooses it.
  const result = page
    .getByRole("dialog")
    .getByRole("button", { name: /^Review trailhead · East/ });
  for (
    let step = 0;
    step < 8 && !(await result.evaluate((el) => el === document.activeElement));
    step++
  )
    await page.keyboard.press("Tab");
  await expect(result).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(start).toContainText("Review trailhead · East");
  // Escape from a dialog gives focus back to the control that opened it.
  await start.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(start).toBeFocused();
  // Help: focus enters the dialog and Escape returns it.
  const help = page.getByRole("button", { name: /^Help/ }).first();
  await help.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Help and about" });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(help).toBeFocused();
});

test("[engine] browser Back and Forward move between screens and do not leave the app", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await nav(page, "Saved").click();
  await expect(
    page.getByRole("heading", { name: "Saved", exact: true, level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Saved", exact: true, level: 1 }),
  ).toBeVisible();
  expect(page.url()).toMatch(/\/$/);
});

test("[engine] no automatically detectable WCAG 2 A/AA violations on the planner, preview and Help", async ({
  page,
}) => {
  const check = async (what: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations, what).toEqual([]);
  };
  await openPlanner(page);
  await check("planner");
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await check("route preview");
  await page.getByRole("button", { name: /^Help/ }).first().click();
  await expect(
    page.getByRole("dialog", { name: "Help and about" }),
  ).toBeVisible();
  await check("Help");
});

test("[engine] at 175% text no screen scrolls sideways, except the known limit on the smallest phone", async ({
  page,
}, info) => {
  const smallest = info.project.name === "webkit-iphone-se";
  const overflowing: string[] = [];
  const large = () =>
    page.evaluate(() => (document.documentElement.style.fontSize = "28px"));
  await planPoint(page);
  await large();
  if (!(await fitsWidth(page))) overflowing.push("Route preview");
  // A reload restores the preview; go home to reach the tabs.
  await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await large();
  for (const tab of tabs) {
    await nav(page, tab).click();
    if (!(await fitsWidth(page))) overflowing.push(tab);
  }
  if (smallest) {
    // Known limit, recorded not hidden: 320 pt wide at 175% text. See docs/web/launch-acceptance.md.
    info.annotations.push({
      type: "known-limit",
      description: `175% text on a 320 pt screen scrolls sideways on: ${overflowing.join(", ") || "nothing"}`,
    });
  } else expect(overflowing).toEqual([]);
});
