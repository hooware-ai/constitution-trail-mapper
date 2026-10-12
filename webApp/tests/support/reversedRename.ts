// Saved-route names belong to the planned identity even while its proved reversal is the retained preview.
// The real app, worker and Kotlin router run on synthetic fixture data; no route or app state is substituted.
// Keyboard rename, Back, reload and library-readiness assertions are browser emulation, not physical speech/GPS.
import { test, expect, type Page, type Locator } from "@playwright/test";
import { choose, planPoint } from "../webkit/support";

type Stored = { key: string; title: string; plannedKey?: string };
const SESSION = "trail-mapper.fixture:trail-mapper.web.session.v1";
const LIBRARY = "trail-mapper.fixture:trail-mapper.web.library.v1";
const selection = (page: Page) =>
  page.evaluate((key) => {
    const record = JSON.parse(localStorage.getItem(key) ?? "null")?.selected;
    return record
      ? { key: record.key, title: record.title, plannedKey: record.plannedKey }
      : null;
  }, SESSION) as Promise<Stored | null>;
const saved = (page: Page) =>
  page.evaluate(
    (key) =>
      (JSON.parse(localStorage.getItem(key) ?? "null")?.saved ?? []).map(
        (r: Stored) => ({ key: r.key, title: r.title }),
      ),
    LIBRARY,
  ) as Promise<Array<{ key: string; title: string }>>;
const preview = (page: Page) =>
  page.getByRole("heading", { name: "Route preview", exact: true });
const title = (page: Page) => page.locator(".panel h2");
const view = (page: Page) =>
  page.getByRole("button", { name: "Saved · View", exact: true });
const reverse = (page: Page) =>
  page.getByRole("button", { name: "Reverse direction", exact: true });

async function planSavedLoop(page: Page, first = true) {
  if (first) await page.goto("/?fixture");
  else
    await page
      .getByRole("button", { name: "Trail Mapper home", exact: true })
      .click();
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: "5 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(preview(page)).toBeVisible();
  // A prior preview may still be persisted while the new loop's debounced write settles. Require the current visible
  // loop's planned record, not merely any non-null selection (which could still be the unrelated point route).
  await expect
    .poll(() => selection(page))
    .toMatchObject({
      title: await title(page).innerText(),
      plannedKey: undefined,
    });
  const planned = (await selection(page))!;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(view(page)).toBeVisible();
  await reverse(page).click();
  await expect(page.locator(".direction-control span")).toHaveText(
    "Riding in reverse",
  );
  await expect
    .poll(() => selection(page))
    .toMatchObject({ plannedKey: planned.key });
  const reversed = (await selection(page))!;
  expect(reversed.key).not.toBe(planned.key);
  await view(page).click();
  return { planned, reversed };
}
async function tabTo(page: Page, target: Locator) {
  for (
    let i = 0;
    i < 60 && !(await target.evaluate((e) => e === document.activeElement));
    i++
  )
    await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
}
async function enterRename(page: Page, oldName: string, newName: string) {
  const opener = page.getByRole("button", {
    name: "Rename " + oldName,
    exact: true,
  });
  await tabTo(page, opener);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename", exact: true });
  const input = dialog.getByRole("textbox", { name: "Name", exact: true });
  await expect(input).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(newName);
  await page.keyboard.press("Enter");
  return { dialog, input };
}
async function renamed(page: Page, name: string) {
  await expect(
    page.getByRole("dialog", { name: "Rename", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rename " + name, exact: true }),
  ).toBeFocused();
}
async function backToPreview(page: Page) {
  for (let i = 0; i < 5 && !(await preview(page).isVisible()); i++)
    await page.goBack();
  await expect(preview(page)).toBeVisible();
}

test("[engine] a saved loop renamed from its reversed preview keeps the new name through Back, reload and reverse-back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { planned, reversed } = await planSavedLoop(page);
  const name = "Morning park loop";
  await enterRename(page, planned.title, name);
  await renamed(page, name);
  await backToPreview(page);
  await expect(title(page)).toHaveText(name);
  await expect(view(page)).toBeVisible();
  await expect
    .poll(() => selection(page))
    .toMatchObject({ key: reversed.key, plannedKey: planned.key, title: name });
  expect(await saved(page)).toEqual([{ key: planned.key, title: name }]);
  await page.reload();
  await expect(preview(page)).toBeVisible();
  await expect(title(page)).toHaveText(name);
  await expect(reverse(page)).toBeEnabled();
  await expect(view(page)).toBeVisible();
  await reverse(page).click();
  await expect(page.locator(".direction-control span")).toHaveText(
    "Planned direction",
  );
  await expect(title(page)).toHaveText(name);
  await expect
    .poll(() => selection(page))
    .toEqual({ key: planned.key, title: name, plannedKey: undefined });
  await page.reload();
  await expect(preview(page)).toBeVisible();
  await expect(title(page)).toHaveText(name);
  expect(await saved(page)).toEqual([{ key: planned.key, title: name }]);
  expect(errors).toEqual([]);
});

test("[engine] renaming another saved route leaves the retained reversed loop's name and identities unchanged", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await planPoint(page);
  await expect.poll(() => selection(page)).not.toBeNull();
  const point = (await selection(page))!;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const { planned, reversed } = await planSavedLoop(page, false);
  expect(point.key).not.toBe(planned.key);
  const name = "South trail ride";
  await enterRename(page, point.title, name);
  await renamed(page, name);
  await backToPreview(page);
  await expect(title(page)).toHaveText(planned.title);
  await expect.poll(() => selection(page)).toEqual(reversed);
  await expect(view(page)).toBeVisible();
  await reverse(page).click();
  await expect(page.locator(".direction-control span")).toHaveText(
    "Planned direction",
  );
  await expect(title(page)).toHaveText(planned.title);
  await expect
    .poll(() => selection(page))
    .toEqual({ key: planned.key, title: planned.title, plannedKey: undefined });
  const library = await saved(page);
  expect(library).toContainEqual({ key: point.key, title: name });
  expect(library).toContainEqual({ key: planned.key, title: planned.title });
  await page.reload();
  await expect(preview(page)).toBeVisible();
  await expect(title(page)).toHaveText(planned.title);
  expect(await saved(page)).toEqual(library);
  expect(errors).toEqual([]);
});

test("[engine] failed Rename keeps the saved and reversed names until a keyboard retry succeeds at 200% landscape text", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { planned, reversed } = await planSavedLoop(page);
  await page.setViewportSize({ width: 640, height: 320 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as any).__renameSetItem = original;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key)
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      return original.call(this, name, value);
    };
  }, LIBRARY);
  const name = "Evening park loop";
  const { dialog, input } = await enterRename(page, planned.title, name);
  await expect(dialog.getByRole("alert")).toHaveText(
    "Browser storage is full. This change was not saved.",
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(name);
  expect(await saved(page)).toEqual([
    { key: planned.key, title: planned.title },
  ]);
  await page.evaluate(
    () => (Storage.prototype.setItem = (window as any).__renameSetItem),
  );
  await page.keyboard.press("Enter");
  await renamed(page, name);
  await backToPreview(page);
  await expect(title(page)).toHaveText(name);
  await expect
    .poll(() => selection(page))
    .toMatchObject({ key: reversed.key, plannedKey: planned.key, title: name });
  expect(await saved(page)).toEqual([{ key: planned.key, title: name }]);
  expect(errors).toEqual([]);
});
