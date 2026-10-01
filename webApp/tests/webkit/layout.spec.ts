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

/** What a rider would experience as broken at large text: sideways scrolling, a control off the screen, cut-off text. */
async function problems(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const shown = (el: Element) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        box.width > 0 &&
        box.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}"`;
    const out: string[] = [];
    const scrolls = document.documentElement.scrollWidth - width;
    if (scrolls > 1) {
      // Name the widest culprits (the text range as well as the box: a long word can overflow a box that looks narrow).
      const wide: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest(".leaflet-container")) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        const right = Math.max(
          range.getBoundingClientRect().right,
          el.getBoundingClientRect().right,
        );
        if (right > width + 1 && el.getBoundingClientRect().width > 2)
          wide.push(`${name(el)} reaches ${Math.round(right)}px`);
      }
      out.push(
        `page scrolls sideways by ${scrolls}px; reaching past the edge: ${wide.slice(-4).join("; ")}`,
      );
    }
    for (const el of document.querySelectorAll(
      "button, a[href], input, select, textarea, [role=button]",
    )) {
      if (!shown(el)) continue;
      const box = el.getBoundingClientRect();
      if (box.right > width + 1 || box.left < -1)
        out.push(`off the screen: ${name(el)}`);
    }
    for (const el of document.querySelectorAll("body *")) {
      if (!shown(el) || el.closest(".leaflet-container")) continue;
      // Visually hidden helper text (screen-reader only) is meant to be clipped.
      const own = el.getBoundingClientRect();
      if (own.width <= 2 && own.height <= 2) continue;
      const style = getComputedStyle(el);
      // A scroll container whose content is wider than it is (the planner column scrolling inside itself) is as broken as
      // cut-off text: controls start off its edge.
      const cuts = ["hidden", "clip", "auto", "scroll"].includes(
        style.overflowX,
      );
      if (cuts && el.scrollWidth > el.clientWidth + 1)
        out.push(`cut off or scrolls inside itself: ${name(el)}`);
    }
    return out;
  });
}
const sound = async (page: Page, what: string) =>
  expect(await problems(page), what).toEqual([]);

for (const [percent, wide] of [
  [175, false],
  [200, false],
  [175, true],
  [200, true],
] as const) {
  test(`[engine] at ${percent}% text${wide ? " with wider letters" : ""} every key screen fits, nothing is cut off, and controls stay reachable`, async ({
    page,
  }, info) => {
    const size = `${(16 * percent) / 100}px`;
    await page.goto("/");
    if (wide)
      // Stands in for a wider fallback font (the hosted Linux runner has one): every letter 0.14em wider (harsher than the hosted runner).
      await page.addStyleTag({
        content: "*{letter-spacing:0.14em !important}",
      });
    await page.evaluate(
      (px) => (document.documentElement.style.fontSize = px),
      size,
    );
    for (const tab of tabs) {
      await nav(page, tab).click();
      await sound(page, `${tab} at ${percent}%`);
    }
    // The tabs are still big enough to touch, and the bar does not hide the page.
    if (info.project.name.includes("iphone")) {
      for (const tab of tabs) {
        const box = await nav(page, tab).boundingBox();
        expect(Math.min(box!.width, box!.height), tab).toBeGreaterThanOrEqual(
          44,
        );
      }
    }
    await nav(page, "Plan").click();
    await page.getByRole("button", { name: /Go somewhere/ }).click();
    await sound(page, "planner");
    await page.getByRole("button", { name: /^Start:/ }).click();
    await sound(page, "place chooser");
    await page
      .getByRole("button", { name: "Pick on map", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Use map center" }),
    ).toBeVisible();
    await sound(page, "map picker");
    await page.getByRole("button", { name: "Use map center" }).click();
    await choose(page, "Destination", "Review trailhead · South");
    await page.getByRole("button", { name: "Find route", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Route preview", exact: true }),
    ).toBeVisible();
    await sound(page, "route preview");
    for (const name of ["Directions", "Share"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await sound(page, `${name} dialog`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
    }
    // The primary action is reachable by scrolling to it and is on the screen when there.
    const start = page.getByRole("button", {
      name: "Start navigation",
      exact: true,
    });
    await start.scrollIntoViewIfNeeded();
    const box = await start.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
    await page.getByRole("button", { name: /^Help/ }).first().click();
    await expect(
      page.getByRole("dialog", { name: "Help and about" }),
    ).toBeVisible();
    await sound(page, "Help dialog");
  });
}
