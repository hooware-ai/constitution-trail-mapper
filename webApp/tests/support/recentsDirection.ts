// Saving from Recents while a restored reversed route's direction is still unresolved (issue #17), run unchanged by the
// Chromium (tests/e2e) and WebKit (tests/webkit) suites against the real app, worker and Kotlin router on the synthetic
// fixture graph.
//
// Only the timing of the restored route's own "reverse" proof is held: its request is posted later with the very same
// arguments (message and transfer list), and its answer is the real worker's, untouched. Every other worker message is
// forwarded at once. No app state is written programmatically; the reversed record comes from a real reload of a route
// the rider reversed. These are engine results only, not physical-device acceptance.
import { test, expect, type Page } from "@playwright/test";
import { choose, planPoint } from "../webkit/support";

type Stored = { key: string; title: string; plannedKey?: string };

const SESSION = "trail-mapper.fixture:trail-mapper.web.session.v1";

/** Holds the restored route's reverse proofs (only in a document whose restored session claims a planned direction). */
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

const counter = (page: Page, name: "__heldReverse" | "__answeredReverse") =>
  page.evaluate((n) => (window as any)[n] as number, name);
const release = (page: Page) =>
  page.evaluate(() => (window as any).__releaseReverse());

const sessionSelected = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null")?.selected ?? null,
    SESSION,
  ) as Promise<Stored | null>;

/** The route library exactly as written to browser storage. */
const storedLibrary = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.endsWith("trail-mapper.web.library.v1"),
    );
    const library = JSON.parse(localStorage.getItem(key!)!);
    return {
      saved: library.saved.map((r: { key: string }) => r.key) as string[],
      recent: library.recent.map((r: { key: string }) => r.key) as string[],
    };
  });

const previewHeading = (page: Page) =>
  page.getByRole("heading", { name: "Route preview", exact: true });
const previewSave = (page: Page) =>
  page.getByRole("button", { name: "Save", exact: true });

/**
 * Plans a point route (left in Recents) and a loop, reverses the loop, and reloads: the reversed loop comes back with its
 * direction to be proved, and that proof's request is held.
 */
async function restoreReversedLoop(page: Page) {
  await page.addInitScript(holdRestoredReverse);
  await planPoint(page);
  await expect.poll(() => sessionSelected(page)).not.toBeNull();
  const point = (await sessionSelected(page))!;
  await page
    .getByRole("button", { name: "Trail Mapper home", exact: true })
    .click();
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: "5 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  await expect(previewHeading(page)).toBeVisible();
  await page
    .getByRole("button", { name: "Reverse direction", exact: true })
    .click();
  await expect
    .poll(async () => !!(await sessionSelected(page))?.plannedKey)
    .toBe(true);
  const reversed = (await sessionSelected(page))!;
  expect(reversed.key).not.toBe(reversed.plannedKey);
  expect(point.key).not.toBe(reversed.key);
  expect(point.key).not.toBe(reversed.plannedKey);

  await page.reload();
  await expect.poll(() => counter(page, "__heldReverse")).toBe(1);
  await expect(previewHeading(page)).toBeVisible();
  // Its own Save waits for the proof.
  await expect(previewSave(page)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Reverse direction", exact: true }),
  ).toBeDisabled();
  return { point, reversed };
}

test("[engine] an unrelated Recent saves while a restored reversed route stays unresolved, which saves only its planned identity once proved", async ({
  page,
}) => {
  const { point, reversed } = await restoreReversedLoop(page);

  // Leave the unresolved preview for Recents; the abandoned proof's real answer then arrives and settles nothing.
  await page.getByRole("button", { name: "← Back", exact: true }).click();
  await page
    .getByRole("button", { name: "Trail Mapper home", exact: true })
    .click();
  await page.getByRole("button", { name: "See all", exact: true }).click();
  await release(page);
  await expect.poll(() => counter(page, "__answeredReverse")).toBe(1);

  const savePoint = page.getByRole("button", {
    name: "Save " + point.title,
    exact: true,
  });
  await expect(savePoint).toBeEnabled();
  await savePoint.click();
  await expect(
    page.getByText("Saved to Saved routes", { exact: true }),
  ).toBeVisible();
  await expect(savePoint).toHaveCount(0);
  let library = await storedLibrary(page);
  expect(library.saved).toEqual([point.key]);
  expect(library.recent).not.toContain(point.key);

  // Browser Back shows the retained reversed preview again: still blocked, and proved afresh under a new request.
  for (let i = 0; i < 5 && !(await previewHeading(page).isVisible()); i++)
    await page.goBack();
  await expect(previewHeading(page)).toBeVisible();
  await expect.poll(() => counter(page, "__heldReverse")).toBe(2);
  await expect(previewSave(page)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Reverse direction", exact: true }),
  ).toBeDisabled();
  // The retained reversed record is exactly as it was: the unrelated save neither settled nor rewrote it.
  await expect
    .poll(() => sessionSelected(page))
    .toMatchObject({
      key: reversed.key,
      plannedKey: reversed.plannedKey,
    });
  expect((await storedLibrary(page)).saved).toEqual([point.key]);

  await release(page);
  await expect.poll(() => counter(page, "__answeredReverse")).toBe(2);
  await expect(previewSave(page)).toBeEnabled();
  await previewSave(page).click();
  await expect(
    page.getByRole("button", { name: "Saved · View", exact: true }),
  ).toBeVisible();
  library = await storedLibrary(page);
  // Stored under the planned route's identity, never under the reversed geometry key.
  expect([...library.saved].sort()).toEqual(
    [point.key, reversed.plannedKey!].sort(),
  );
  expect(library.saved).not.toContain(reversed.key);

  // Persisted: a real reload keeps both saves and the point route stays out of Recents.
  await page.reload();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  library = await storedLibrary(page);
  expect([...library.saved].sort()).toEqual(
    [point.key, reversed.plannedKey!].sort(),
  );
  expect(library.recent).not.toContain(point.key);
  expect(library.saved).not.toContain(reversed.key);
});
