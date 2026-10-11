// Keyboard ownership of the saved route/place Rename dialog (issue #17), run unchanged by the Chromium (tests/e2e) and
// WebKit (tests/webkit) suites against the real app, worker and Kotlin router.
//
// Every route is planned by the real router and saved through the real Save and "Save destination as a place" actions.
// Every Rename dialog is opened from the keyboard: the Rename button is reached with Tab and activated with Enter or
// Space. Nothing here focuses the Name field programmatically, so a passing "Name is focused" assertion means the app put
// focus there itself. These are engine results only, not TalkBack, VoiceOver or physical-device speech acceptance.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { choose } from "../webkit/support";

const ROUTE = "Review trailhead · East to Review trailhead · South";
const PLACE = "Review trailhead · South";

const savedNav = (page: Page) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true });
const savedHeading = (page: Page) =>
  page.getByRole("heading", { name: "Saved", exact: true, level: 1 });
const renameButton = (page: Page, name: string) =>
  page.getByRole("button", { name: "Rename " + name, exact: true });
const renameDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Rename", exact: true });
const nameInput = (page: Page) =>
  renameDialog(page).getByRole("textbox", { name: "Name", exact: true });

/** Plans East → South with the real router, then saves the route and its destination through the preview's own actions. */
async function planAndSave(page: Page) {
  await page.goto("/?fixture");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const view = page.getByRole("button", { name: "Saved · View", exact: true });
  await expect(view).toBeVisible();
  await page.getByText("More actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Save destination as a place", exact: true })
    .click();
  await expect(page.getByText("Place saved", { exact: true })).toBeVisible();
  await view.click();
  await expect(savedHeading(page)).toBeVisible();
  await expect(renameButton(page, ROUTE)).toBeVisible();
  await expect(renameButton(page, PLACE)).toBeVisible();
}

/** A real document reload: only what the library wrote to browser storage survives it. */
async function reloadToSaved(page: Page) {
  await page.reload();
  await expect(savedNav(page)).toBeVisible();
  await savedNav(page).click();
  await expect(savedHeading(page)).toBeVisible();
}

/** The saved library exactly as written to browser storage. */
const storedNames = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith("trail-mapper.web.library.v1"),
    );
    const library = JSON.parse(localStorage.getItem(key!)!);
    return {
      routes: library.saved.map((r: { title: string }) => r.title),
      places: library.places.map((p: { label: string }) => p.label),
    };
  });

/** Reaches a control with Tab only, as a keyboard rider would. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate((e) => e === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target, "Tab must reach the Rename button").toBeFocused();
}

/** Opens Rename for `name` from the keyboard, marking the exact button element that started it. */
async function openRename(page: Page, name: string, key = "Enter") {
  const opener = renameButton(page, name);
  await tabTo(page, opener);
  // An inert marker on the element (not focus): proves later that focus returns to this very node.
  await opener.evaluate((e) => ((e as any).__renameOpener = true));
  await page.keyboard.press(key);
  await expect(renameDialog(page)).toBeVisible();
  // The Name field owns focus as soon as the dialog opens, without any click or programmatic focus.
  await expect(nameInput(page)).toBeFocused();
  await expect(nameInput(page)).toHaveValue(name);
  return opener;
}

async function expectFocusReturned(page: Page, opener: Locator) {
  await expect(renameDialog(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(() => (document.activeElement as any)?.__renameOpener),
    "focus returns to the exact Rename button that opened the dialog",
  ).toBe(true);
  await opener.evaluate((e) => delete (e as any).__renameOpener);
}

/** Replaces the field's text with typed keys only. */
async function typeName(page: Page, text: string) {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await expect(nameInput(page)).toHaveValue(text);
}

/** Every write to the saved library fails as a full browser storage would. */
const failLibraryWrites = (page: Page) =>
  page.evaluate(() => {
    const real = Storage.prototype.setItem;
    (window as any).__setItem = real;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name.endsWith("trail-mapper.web.library.v1"))
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      return real.call(this, name, value);
    };
  });
const restoreLibraryWrites = (page: Page) =>
  page.evaluate(() => {
    Storage.prototype.setItem = (window as any).__setItem;
  });

async function expectNativeForm(page: Page) {
  const input = nameInput(page);
  // A native text field labelled Name, inside the form whose submit button saves it.
  expect(
    await input.evaluate((e) => ({
      tag: e.tagName,
      type: (e as HTMLInputElement).type,
      form: !!(e as HTMLInputElement).form,
      max: (e as HTMLInputElement).maxLength,
    })),
  ).toEqual({ tag: "INPUT", type: "text", form: true, max: 120 });
  await expect(
    renameDialog(page).getByRole("button", { name: "Save name", exact: true }),
  ).toHaveAttribute("type", "submit");
  for (const control of [
    input,
    renameDialog(page).getByRole("button", { name: "Close Rename" }),
    renameDialog(page).getByRole("button", { name: "Cancel", exact: true }),
    renameDialog(page).getByRole("button", { name: "Save name", exact: true }),
  ]) {
    const box = (await control.boundingBox())!;
    expect(
      box.height,
      await control.evaluate((e) => e.outerHTML),
    ).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
}

test("[engine] saved route and saved place Rename open from the keyboard, take typed keys, save on Enter and persist across reload", async ({
  page,
}) => {
  await planAndSave(page);
  const renamed = [
    [ROUTE, "Morning river ride"],
    [PLACE, "South lot"],
  ] as const;
  for (const [before, after] of renamed) {
    const opener = await openRename(page, before);
    await expectNativeForm(page);
    await typeName(page, after);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Name updated", { exact: true })).toBeVisible();
    // The same row's button now carries the new name and holds focus again.
    await expect(opener).toHaveCount(0);
    const renamedOpener = renameButton(page, after);
    await expectFocusReturned(page, renamedOpener);
  }
  await expect(
    page.getByText("Morning river ride", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("South lot", { exact: true })).toBeVisible();
  expect(await storedNames(page)).toEqual({
    routes: ["Morning river ride"],
    places: ["South lot"],
  });

  await reloadToSaved(page);
  await expect(renameButton(page, "Morning river ride")).toBeVisible();
  await expect(renameButton(page, "South lot")).toBeVisible();
  await expect(renameButton(page, ROUTE)).toHaveCount(0);
  await expect(renameButton(page, PLACE)).toHaveCount(0);
  // After the reload the persisted names open from the keyboard just the same; Space activates too.
  await openRename(page, "Morning river ride", " ");
  await page.keyboard.press("Escape");
  await expectFocusReturned(page, renameButton(page, "Morning river ride"));
});

test("[engine] Escape, Cancel and Close keep the prior name, discard the typed draft, and return to the exact Rename button", async ({
  page,
}) => {
  await planAndSave(page);
  // Repeated sessions across both records: no draft, notice or focus target leaks from one into the next.
  const sessions = [
    [ROUTE, "Escape"],
    [PLACE, "Cancel"],
    [ROUTE, "Close"],
    [PLACE, "Escape"],
    [PLACE, "Close"],
    [ROUTE, "Cancel"],
  ] as const;
  for (const [name, dismiss] of sessions) {
    const opener = await openRename(page, name);
    await expect(renameDialog(page).getByRole("alert")).toHaveText("");
    await typeName(page, "Unsaved draft " + dismiss);
    if (dismiss === "Escape") await page.keyboard.press("Escape");
    else if (dismiss === "Cancel") {
      await page.keyboard.press("Tab");
      await expect(
        renameDialog(page).getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
    } else {
      // The dialog's Close button is the stop before the Name field.
      await page.keyboard.press("Shift+Tab");
      await expect(
        renameDialog(page).getByRole("button", { name: "Close Rename" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
    }
    await expectFocusReturned(page, opener);
    await expect(page.getByText("Name updated", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText(/^Unsaved draft/)).toHaveCount(0);
  }
  expect(await storedNames(page)).toEqual({ routes: [ROUTE], places: [PLACE] });
  await reloadToSaved(page);
  await expect(renameButton(page, ROUTE)).toBeVisible();
  await expect(renameButton(page, PLACE)).toBeVisible();
});

test("[engine] a storage failure keeps Rename open with the typed name and its reason, and the same submit succeeds once storage works", async ({
  page,
}) => {
  await planAndSave(page);
  const full = "Browser storage is full. This change was not saved.";

  // Route: the failed save keeps the dialog, the typed name and focus; retrying with Enter saves it.
  let opener = await openRename(page, ROUTE);
  await typeName(page, "Kept through a full disk");
  await failLibraryWrites(page);
  await page.keyboard.press("Enter");
  await expect(renameDialog(page).getByRole("alert")).toHaveText(full);
  await expect(nameInput(page)).toBeFocused();
  await expect(nameInput(page)).toHaveValue("Kept through a full disk");
  await expect(page.getByText("Name updated", { exact: true })).toHaveCount(0);
  await restoreLibraryWrites(page);
  expect((await storedNames(page)).routes).toEqual([ROUTE]);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Name updated", { exact: true })).toBeVisible();
  await expectFocusReturned(
    page,
    renameButton(page, "Kept through a full disk"),
  );

  // Place: a failed save then Escape keeps the prior name, and the next session starts clean.
  opener = await openRename(page, PLACE);
  await typeName(page, "Never stored");
  await failLibraryWrites(page);
  await page.keyboard.press("Enter");
  await expect(renameDialog(page).getByRole("alert")).toHaveText(full);
  await expect(nameInput(page)).toHaveValue("Never stored");
  await restoreLibraryWrites(page);
  await page.keyboard.press("Escape");
  await expectFocusReturned(page, opener);
  await openRename(page, PLACE);
  await expect(renameDialog(page).getByRole("alert")).toHaveText("");
  await page.keyboard.press("Escape");
  await expectFocusReturned(page, opener);

  expect(await storedNames(page)).toEqual({
    routes: ["Kept through a full disk"],
    places: [PLACE],
  });
  await reloadToSaved(page);
  await expect(renameButton(page, "Kept through a full disk")).toBeVisible();
  await expect(renameButton(page, PLACE)).toBeVisible();
  await expect(renameButton(page, "Never stored")).toHaveCount(0);
});

test("[engine] landscape large text: Rename opens on Name with 44px controls and saves by keyboard", async ({
  page,
}) => {
  await planAndSave(page);
  await page.setViewportSize({ width: 640, height: 320 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  const opener = await openRename(page, PLACE);
  await expect(nameInput(page)).toBeInViewport();
  await expectNativeForm(page);
  await typeName(page, "Big text lot");
  // The submit button is reachable by Tab and scrolled into view when it takes focus.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const save = renameDialog(page).getByRole("button", {
    name: "Save name",
    exact: true,
  });
  await expect(save).toBeFocused();
  await expect(save).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(opener).toHaveCount(0);
  await expectFocusReturned(page, renameButton(page, "Big text lot"));
  expect((await storedNames(page)).places).toEqual(["Big text lot"]);
});
