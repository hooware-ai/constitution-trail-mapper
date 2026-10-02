// An automated WCAG 2 A/AA sweep of every main screen and dialog of the guest journey, shared by the Chromium and WebKit
// specs. axe is an automated check only (NOT a screen reader): assistive-technology use stays on the operator checklist in
// docs/web/launch-acceptance.md. Fixture network, scripted location, no real tiles.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { choose, fix, simulateDevice, startButton } from "../webkit/support";

let checked: string[] = [];
async function clean(page: Page, screen: string) {
  checked.push(screen);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const found = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(" | ")}`,
  );
  expect(found, screen).toEqual([]);
}
const nav = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("button", { name, exact: true });

export const SCREENS = [
  "Plan (home)",
  "Saved (empty library)",
  "Explore (empty library)",
  "Updates (empty library)",
  "planner",
  "place chooser dialog",
  "map picker",
  "route preview",
  "Directions dialog",
  "Share dialog",
  "Help dialog",
  "Saved (route and place)",
  "active navigation",
];

export async function sweepScreens(page: Page): Promise<string[]> {
  checked = [];
  await simulateDevice(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await clean(page, "Plan (home)");
  for (const tab of ["Saved", "Explore", "Updates"]) {
    await nav(page, tab).click();
    await clean(page, `${tab} (empty library)`);
  }
  await nav(page, "Plan").click();
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await clean(page, "planner");
  await page.getByRole("button", { name: /^Start:/ }).click();
  await clean(page, "place chooser dialog");
  await page.getByRole("button", { name: "Pick on map", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use map center" }),
  ).toBeVisible();
  await clean(page, "map picker");
  await page.getByRole("button", { name: "Use map center" }).click();
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await clean(page, "route preview");
  for (const name of ["Directions", "Share"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await clean(page, `${name} dialog`);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: /^Help/ }).first().click();
  await expect(
    page.getByRole("dialog", { name: "Help and about" }),
  ).toBeVisible();
  await clean(page, "Help dialog");
  await page.keyboard.press("Escape");
  // Saved with a route and a place in it.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Save destination as a place" })
    .click();
  await page.getByRole("button", { name: "Trail Mapper home" }).click();
  await nav(page, "Saved").click();
  await expect(
    page.getByRole("button", { name: /Review trailhead/ }).first(),
  ).toBeVisible();
  await clean(page, "Saved (route and place)");
  // Active foreground navigation.
  await nav(page, "Plan").click();
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  // A saved place now repeats a catalog name, so take the first match.
  for (const [field, name] of [
    ["Start", "Review trailhead · East"],
    ["Destination", "Review trailhead · South"],
  ] as const) {
    await page.getByRole("button", { name: new RegExp(`^${field}:`) }).click();
    await page.getByRole("textbox", { name: "Search places" }).fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(name) })
      .first()
      .click();
  }
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await startButton(page).click();
  // The scripted fix goes in only once the app is waiting for one (its location watch is registered).
  await expect(
    page.getByRole("heading", { name: "Reacquiring location…", exact: true }),
  ).toBeVisible();
  await fix(page, 40.51, -88.95);
  await expect(page.locator(".guidance.navigating")).toBeVisible();
  await clean(page, "active navigation");
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  return checked;
}
