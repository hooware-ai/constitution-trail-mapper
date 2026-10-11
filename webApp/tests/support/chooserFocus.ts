// Keyboard ownership of the place chooser (issue #7), run unchanged by the Chromium (tests/e2e) and WebKit
// (tests/webkit) suites against the real app, worker and Kotlin router.
//
// Every chooser is opened from the keyboard: the endpoint control is reached with Tab and activated with Enter or
// Space. Nothing here focuses the search field programmatically, so a passing "Search places is focused" assertion
// means the app put focus there itself.
import { test, expect, type Locator, type Page } from "@playwright/test";

type Field = "Start" | "Destination";

const opener = (page: Page, field: Field) =>
  page.getByRole("button", { name: new RegExp("^" + field + ":") });
const chooser = (page: Page, field: Field) =>
  page.getByRole("dialog", { name: "Choose " + field.toLowerCase() });
const search = (page: Page) =>
  page.getByRole("textbox", { name: "Search places" });
// The same set the dialog's Tab wrap uses: its first and last keyboard stops.
const tabStops = (dialog: Locator) =>
  dialog.locator(
    'button:not(:disabled),input:not(:disabled),select,a[href],[tabindex="0"]',
  );

const focusInside = (dialog: Locator) =>
  dialog.evaluate((d) => d.contains(document.activeElement));

async function openPlanner(page: Page) {
  await page.goto("/?fixture");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await expect(opener(page, "Start")).toBeVisible();
}

/** Reaches an endpoint control with Tab only, as a keyboard rider would. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 40; i++) {
    if (await target.evaluate((e) => e === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target, "Tab must reach the endpoint control").toBeFocused();
}

async function openByKeyboard(page: Page, field: Field, key = "Enter") {
  await tabTo(page, opener(page, field));
  await page.keyboard.press(key);
  const dialog = chooser(page, field);
  await expect(dialog).toBeVisible();
  // The search field owns focus as soon as the chooser opens, without any click or programmatic focus.
  await expect(search(page)).toBeFocused();
  return dialog;
}

/** Resolves both endpoints through the chooser, as the existing planner helpers do. */
async function choose(page: Page, field: Field, name: string) {
  await opener(page, field).click();
  await search(page).fill(name);
  await chooser(page, field)
    .getByRole("button", { name: new RegExp(name) })
    .click();
  await expect(chooser(page, field)).toHaveCount(0);
  await expect(opener(page, field)).toHaveAccessibleName(
    field + ": " + name,
  );
}

for (const field of ["Start", "Destination"] as const) {
  test(`[engine] ${field} opens from the keyboard with Search places focused and Escape returns to ${field}`, async ({
    page,
  }) => {
    await openPlanner(page);
    await openByKeyboard(page, field);
    // Typed keys land in the search field, proving it really is the focused control.
    await page.keyboard.type("Review");
    await expect(search(page)).toHaveValue("Review");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener(page, field)).toBeFocused();
    await expect(opener(page, field)).toHaveAccessibleName(
      field + ": Choose a place",
    );
  });

  test(`[engine] ${field} chooser Close button returns focus to ${field}`, async ({
    page,
  }) => {
    await openPlanner(page);
    const dialog = await openByKeyboard(page, field, " ");
    // The Close button is the stop before the search field.
    await page.keyboard.press("Shift+Tab");
    const close = dialog.getByRole("button", {
      name: "Close Choose " + field.toLowerCase(),
    });
    await expect(close).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener(page, field)).toBeFocused();
  });
}

test("[engine] cancelling the chooser keeps resolved endpoints and the planner draft", async ({
  page,
}) => {
  await openPlanner(page);
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");

  // Escape out of a Start chooser holding unsubmitted search text.
  await openByKeyboard(page, "Start");
  await page.keyboard.type("West");
  await expect(
    chooser(page, "Start").getByRole("button", {
      name: /Review trailhead · West/,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener(page, "Start")).toBeFocused();

  // Close out of a Destination chooser holding unsubmitted search text.
  const dialog = await openByKeyboard(page, "Destination");
  await page.keyboard.type("West");
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Close Choose destination" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener(page, "Destination")).toBeFocused();

  await expect(opener(page, "Start")).toHaveAccessibleName(
    "Start: Review trailhead · East",
  );
  await expect(opener(page, "Destination")).toHaveAccessibleName(
    "Destination: Review trailhead · South",
  );
  // Typed text is never saved: a reopened chooser starts empty.
  await openByKeyboard(page, "Start");
  await expect(search(page)).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(opener(page, "Start")).toBeFocused();

  // The retained draft still plans with the real router.
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
});

test("[engine] repeated keyboard openings each focus search and return to their own opener", async ({
  page,
}) => {
  await openPlanner(page);
  const sequence: Array<[Field, string]> = [
    ["Start", "Escape"],
    ["Destination", "Escape"],
    ["Start", "Close"],
    ["Destination", "Close"],
    ["Start", "Escape"],
    ["Start", "Escape"],
  ];
  for (const [field, dismiss] of sequence) {
    const dialog = await openByKeyboard(page, field);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    if (dismiss === "Escape") await page.keyboard.press("Escape");
    else {
      await page.keyboard.press("Shift+Tab");
      await expect(
        dialog.getByRole("button", { name: /^Close Choose / }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener(page, field), `${field} after ${dismiss}`).toBeFocused();
  }
});

test("[engine] Tab and Shift+Tab stay inside the open chooser", async ({
  page,
}) => {
  await openPlanner(page);
  const dialog = await openByKeyboard(page, "Destination");
  const stops = tabStops(dialog);
  const close = dialog.getByRole("button", { name: "Close Choose destination" });
  await expect(stops.first()).toHaveAccessibleName("Close Choose destination");

  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  // Backwards from the first stop wraps to the last one, not to the page behind.
  await page.keyboard.press("Shift+Tab");
  await expect(stops.last()).toBeFocused();
  expect(await focusInside(dialog)).toBe(true);
  // Forwards from the last stop wraps to the first one.
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  // Forwards from Close reaches the search field again.
  await page.keyboard.press("Tab");
  await expect(search(page)).toBeFocused();
  // The planner behind the modal is not reachable while it is open.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInside(dialog), `Tab ${i + 1}`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener(page, "Destination")).toBeFocused();
});
