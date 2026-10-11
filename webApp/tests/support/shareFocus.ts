// Keyboard focus visibility of the Share route dialog's read-only summary (issue #16) at 200% text in a short landscape
// window, run unchanged by the Chromium (tests/e2e) and WebKit (tests/webkit) suites against the real app, worker and
// Kotlin router, on a route that was saved and then reopened from the Saved tab.
//
// The clipboard is replaced by a test adapter that records what the app handed it and refuses; nothing is copied for
// real. Inside the dialog every step is a key press: nothing here focuses or scrolls anything programmatically, so a
// passing "focused and in view" assertion means the app and browser put the field where the rider can see it. Geometry
// is read with getBoundingClientRect only. These are engine results, not TalkBack, VoiceOver or a physical device.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { choose } from "../webkit/support";

const FAILED =
  "Sharing is unavailable. Select and copy the summary shown here, then try again if you like.";
const ROUTE = "Review trailhead · East to Review trailhead · South";

const shareDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Share route", exact: true });
const summaryField = (page: Page) =>
  shareDialog(page).getByRole("textbox", { name: "Summary text", exact: true });
const copyAction = (page: Page) =>
  shareDialog(page).getByRole("button", { name: "Copy summary", exact: true });
const exactBox = (page: Page) =>
  shareDialog(page).getByRole("checkbox", {
    name: /Include exact start and destination/,
  });
const sent = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).__sent);

/** No Web Share, and a clipboard that records then refuses: the app's own fallback is all the rider has. */
async function refusingClipboard(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__sent = [] as string[];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__sent.push(text);
          throw new DOMException("refused", "NotAllowedError");
        },
      },
    });
  });
}

/** Reaches a control with `key` only, as a keyboard rider would. */
async function keyTo(page: Page, target: Locator, what: string, key = "Tab") {
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((e) => e === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  await expect(target, `${key} must reach ${what}`).toBeFocused();
}

/** Where the field and its dialog are on screen, observed only. */
const geometry = (field: Locator) =>
  field.evaluate((e) => {
    const r = e.getBoundingClientRect(),
      d = e.closest("dialog")!,
      dr = d.getBoundingClientRect();
    return {
      focused: e === document.activeElement,
      top: r.top,
      bottom: r.bottom,
      dialogTop: dr.top,
      dialogBottom: dr.bottom,
      dialogScrollTop: d.scrollTop,
      dialogScrollHeight: d.scrollHeight,
      fieldScroll: [e.scrollTop, e.scrollHeight, e.clientHeight],
      selection: [
        (e as HTMLTextAreaElement).selectionStart,
        (e as HTMLTextAreaElement).selectionEnd,
      ],
      scrollY: window.scrollY,
    };
  });

/** Focused, and at least partly inside both the dialog's scrollport and the window. */
async function expectFocusedInView(page: Page, step: string) {
  const field = summaryField(page);
  const g = await geometry(field);
  await test.info().attach(step, { body: JSON.stringify(g, null, 2) });
  expect(g.focused, `${step}: focused`).toBe(true);
  expect(g.bottom, `${step}: ${JSON.stringify(g)}`).toBeGreaterThan(
    g.dialogTop,
  );
  expect(g.top, `${step}: ${JSON.stringify(g)}`).toBeLessThan(g.dialogBottom);
  await expect(field).toBeInViewport();
}

/** Plans East → South with the real router, saves it, and reopens the saved route from the Saved list. */
async function reopenSaved(page: Page) {
  await page.goto("/?fixture");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  const preview = page.getByRole("heading", {
    name: "Route preview",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const view = page.getByRole("button", { name: "Saved · View", exact: true });
  await expect(view).toBeVisible();
  await view.click();
  await expect(
    page.getByRole("heading", { name: "Saved", exact: true, level: 1 }),
  ).toBeVisible();
  await page
    .locator(".route-list li")
    .filter({ hasText: ROUTE })
    .getByRole("button")
    .first()
    .click();
  await expect(preview).toBeVisible();
  return page.url();
}

test("[engine] 200% text short landscape: after a refused copy the reopened saved route's summary is visible wherever Tab or Shift+Tab focuses it", async ({
  page,
}) => {
  await refusingClipboard(page);
  await page.setViewportSize({ width: 640, height: 320 });
  const url = await reopenSaved(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));

  const opener = page.getByRole("button", { name: "Share", exact: true });
  await keyTo(page, opener, "the route's Share button");
  // An inert marker on the element (not focus): proves later that focus returns to this very node.
  await opener.evaluate((e) => ((e as any).__shareOpener = true));
  await page.keyboard.press("Enter");
  await expect(shareDialog(page)).toBeVisible();
  // Opening keeps the dialog's own first stop, not the summary.
  await expect(
    shareDialog(page).getByRole("button", { name: "Close Share route" }),
  ).toBeFocused();
  await expect(summaryField(page)).not.toBeFocused();

  // The export consent is the rider's explicit choice and does not touch the private summary.
  await keyTo(page, exactBox(page), "the exact endpoints checkbox");
  await page.keyboard.press("Space");
  await expect(exactBox(page)).toBeChecked();

  // Forward: Tab wraps through the dialog's own controls; the summary is visible as it passes.
  await keyTo(page, summaryField(page), "the read-only summary text");
  await expectFocusedInView(page, "Tab to summary");
  await keyTo(page, copyAction(page), "Copy summary");
  await page.keyboard.press("Enter");
  await expect(shareDialog(page).getByRole("alert")).toHaveText(FAILED);

  // Reverse: the summary is the stop just before the action.
  await expectNotMoved(page);
  await test.info().attach("before Shift+Tab", {
    body: JSON.stringify(await geometry(summaryField(page)), null, 2),
  });
  await page.keyboard.press("Shift+Tab");
  await expectFocusedInView(page, "Shift+Tab to summary");

  const payload = (await sent(page)).at(-1)!;
  expect(payload).toMatch(
    /^Plan a trail ride with Trail Mapper\. A \d+\.\d mile ride\. Exact start and destination are not shared\.\n/,
  );
  expect(payload.split("\n")[1]).toBe(new URL(page.url()).origin + "/");
  for (const secret of ["Review trailhead", ROUTE, "40.5", "-88.", "?", "#"])
    expect(payload).not.toContain(secret);
  const field = summaryField(page);
  await expect(field).toHaveValue(payload);
  expect(
    await field.evaluate((e) => ({
      tag: e.tagName,
      readOnly: (e as HTMLTextAreaElement).readOnly,
      disabled: (e as HTMLTextAreaElement).disabled,
    })),
  ).toEqual({ tag: "TEXTAREA", readOnly: true, disabled: false });
  // Native selection of the exact payload while the field is still in view.
  await page.keyboard.press("ControlOrMeta+a");
  expect(
    await field.evaluate((e) => {
      const t = e as HTMLTextAreaElement;
      return t.value.slice(t.selectionStart, t.selectionEnd);
    }),
  ).toBe(payload);
  await expectFocusedInView(page, "after selecting all");
  for (const press of ["x", "Backspace", "Delete", "Enter"])
    await page.keyboard.press(press);
  await expect(field).toHaveValue(payload);
  await expect(field).toBeFocused();
  await expect(exactBox(page)).toBeChecked();
  await expect(shareDialog(page).getByRole("alert")).toHaveText(FAILED);

  await page.keyboard.press("Escape");
  await expect(shareDialog(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => (document.activeElement as any)?.__shareOpener),
  ).toBe(true);
  expect(page.url()).toBe(url);
});

/** Focus stays on the action after the refusal; the failure moves nothing. */
async function expectNotMoved(page: Page) {
  await expect(copyAction(page)).toBeFocused();
  await expect(copyAction(page)).toBeInViewport();
}
