// Real router proofs are delayed in delivery only; original requests/transfers and actual replies are unchanged.
// A saved title cannot be adopted from an unproved claim or an abandoned reply. Fixture/browser controls are not GPS.
import { test, expect, type Page, type Locator } from "@playwright/test";
import { choose, planPoint } from "../webkit/support";
function holdRestoredReverse() {
  const saved = JSON.parse(
    localStorage.getItem("trail-mapper.fixture:trail-mapper.web.session.v1") ??
      "null",
  );
  const hold = !!saved?.selected?.plannedKey;
  const original = Worker.prototype.postMessage;
  const queued: Array<() => void> = [];
  const w = window as any;
  w.__heldReverse = 0;
  w.__answeredReverse = 0;
  w.__releaseReverse = () => {
    for (const send of queued.splice(0)) send();
  };
  Worker.prototype.postMessage = function (this: Worker, ...args: any[]) {
    if (hold && args[0]?.request?.op === "reverse") {
      w.__heldReverse++;
      const id = args[0].id;
      // Observes (does not consume) the real answer to this exact request.
      this.addEventListener("message", ({ data }) => {
        if (data?.id === id) w.__answeredReverse++;
      });
      queued.push(() => Reflect.apply(original, this, args));
      return;
    }
    return Reflect.apply(original, this, args);
  } as typeof Worker.prototype.postMessage;
}

type Stored = { key: string; title: string; plannedKey?: string };
const selection = (page: Page) =>
  page.evaluate(() => {
    const r = JSON.parse(
      localStorage.getItem(
        "trail-mapper.fixture:trail-mapper.web.session.v1",
      ) ?? "null",
    )?.selected;
    return r ? { key: r.key, title: r.title, plannedKey: r.plannedKey } : null;
  }) as Promise<Stored | null>;
const library = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        "trail-mapper.fixture:trail-mapper.web.library.v1",
      ) ?? "null",
    )?.saved.map((r: Stored) => ({ key: r.key, title: r.title })),
  ) as Promise<Array<{ key: string; title: string }>>;
const preview = (page: Page) =>
  page.getByRole("heading", { name: "Route preview", exact: true });
const title = (page: Page) => page.locator(".panel h2");
const reverse = (page: Page) =>
  page.getByRole("button", { name: "Reverse direction", exact: true });
const save = (page: Page) =>
  page.getByRole("button", { name: "Save", exact: true });
const view = (page: Page) =>
  page.getByRole("button", { name: "Saved · View", exact: true });
const counter = (page: Page, name: string) =>
  page.evaluate((n) => (window as any)[n] as number, name);
const release = (page: Page) =>
  page.evaluate(() => (window as any).__releaseReverse());
async function setup(page: Page, other = false) {
  await page.addInitScript(holdRestoredReverse);
  let point: Stored | null = null;
  if (other) {
    await planPoint(page);
    await expect.poll(() => selection(page)).not.toBeNull();
    point = (await selection(page))!;
    await save(page).click();
    await expect(view(page)).toBeVisible();
    await page
      .getByRole("button", { name: "Trail Mapper home", exact: true })
      .click();
  } else await page.goto("/?fixture");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: "5 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(preview(page)).toBeVisible();
  await expect
    .poll(() => selection(page))
    .toMatchObject({
      title: await title(page).innerText(),
      plannedKey: undefined,
    });
  const planned = (await selection(page))!;
  await save(page).click();
  await reverse(page).click();
  await expect
    .poll(() => selection(page))
    .toMatchObject({ plannedKey: planned.key });
  const reversed = (await selection(page))!;
  expect(reversed.key).not.toBe(planned.key);
  await page.reload();
  await expect.poll(() => counter(page, "__heldReverse")).toBe(1);
  await expect(preview(page)).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await expect(reverse(page)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "← Back", exact: true }).click();
  await page
    .getByRole("button", { name: "Trail Mapper home", exact: true })
    .click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  return { planned, reversed, point };
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
async function rename(page: Page, oldName: string, newName: string) {
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
async function returnPending(page: Page, planned: Stored, reversed: Stored) {
  await release(page);
  await expect.poll(() => counter(page, "__answeredReverse")).toBe(1);
  for (let i = 0; i < 5 && !(await preview(page).isVisible()); i++)
    await page.goBack();
  await expect(preview(page)).toBeVisible();
  await expect.poll(() => counter(page, "__heldReverse")).toBe(2);
  await expect(save(page)).toBeDisabled();
  await expect(reverse(page)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await expect(title(page)).toHaveText(planned.title);
  await expect.poll(() => selection(page)).toEqual(reversed);
}

test("[engine] only a fresh proved restored direction adopts a successfully renamed saved title after a failed write", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { planned, reversed } = await setup(page);
  await page.setViewportSize({ width: 640, height: 320 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await page.evaluate(() => {
    const old = Storage.prototype.setItem;
    (window as any).__proofRenameWrite = old;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "trail-mapper.fixture:trail-mapper.web.library.v1")
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      return old.call(this, key, value);
    };
  });
  const name = "Late renamed loop";
  const { dialog, input } = await rename(page, planned.title, name);
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText(
    "Browser storage is full. This change was not saved.",
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(name);
  expect(await library(page)).toEqual([
    { key: planned.key, title: planned.title },
  ]);
  await page.evaluate(
    () => (Storage.prototype.setItem = (window as any).__proofRenameWrite),
  );
  await page.keyboard.press("Enter");
  await renamed(page, name);
  expect(await library(page)).toEqual([{ key: planned.key, title: name }]);
  await returnPending(page, planned, reversed);
  await release(page);
  await expect.poll(() => counter(page, "__answeredReverse")).toBe(2);
  await expect(reverse(page)).toBeEnabled();
  await expect(view(page)).toBeVisible();
  await expect(title(page)).toHaveText(name);
  await expect
    .poll(() => selection(page))
    .toEqual({ key: reversed.key, plannedKey: planned.key, title: name });
  expect(await counter(page, "__heldReverse")).toBe(2);
  expect(await library(page)).toEqual([{ key: planned.key, title: name }]);
  await page.reload();
  await expect.poll(() => counter(page, "__heldReverse")).toBe(1);
  await expect(preview(page)).toBeVisible();
  await expect(title(page)).toHaveText(name);
  await expect(save(page)).toBeDisabled();
  await release(page);
  await expect(reverse(page)).toBeEnabled();
  await reverse(page).click();
  // This document's delivery adapter still holds reverse requests, including the rider's explicit reverse-back.
  await expect.poll(() => counter(page, "__heldReverse")).toBe(2);
  await release(page);
  await expect.poll(() => counter(page, "__answeredReverse")).toBe(2);
  await expect(page.locator(".direction-control span")).toHaveText(
    "Planned direction",
  );
  await expect(title(page)).toHaveText(name);
  await expect
    .poll(() => selection(page))
    .toEqual({ key: planned.key, title: name, plannedKey: undefined });
  expect(errors).toEqual([]);
});

test("[engine] a current restored proof keeps its own title when another saved route was renamed", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { planned, reversed, point } = await setup(page, true);
  expect(point!.key).not.toBe(planned.key);
  const name = "Unrelated renamed ride";
  await rename(page, point!.title, name);
  await page.keyboard.press("Enter");
  await renamed(page, name);
  await returnPending(page, planned, reversed);
  await release(page);
  await expect.poll(() => counter(page, "__answeredReverse")).toBe(2);
  await expect(reverse(page)).toBeEnabled();
  await expect(view(page)).toBeVisible();
  await expect(title(page)).toHaveText(planned.title);
  await expect.poll(() => selection(page)).toEqual(reversed);
  expect(await library(page)).toContainEqual({ key: point!.key, title: name });
  expect(await library(page)).toContainEqual({
    key: planned.key,
    title: planned.title,
  });
  expect(await counter(page, "__heldReverse")).toBe(2);
  expect(errors).toEqual([]);
});
