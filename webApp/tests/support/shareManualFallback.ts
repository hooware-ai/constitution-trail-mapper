// Keyboard-reachable manual copy fallback in the Share route dialog (issue #16), run unchanged by the Chromium (tests/e2e)
// and WebKit (tests/webkit) suites against the real app, worker and Kotlin router.
//
// Every route is planned by the real router. navigator.share and navigator.clipboard are replaced by test adapters that
// record what the app handed them and then refuse, cancel or accept; nothing is shared or copied for real. Inside the
// dialog every step is a key press: nothing here focuses the summary field programmatically, so a passing "focused"
// assertion means Tab took the rider there. Selection is proven in the browser engine only, not the OS clipboard, a real
// share sheet, TalkBack or VoiceOver.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { choose } from "../webkit/support";

type Mode = "reject" | "abort" | "ok";
const FAILED =
  "Sharing is unavailable. Select and copy the summary shown here, then try again if you like.";
const SAVED_TITLE = "Review trailhead · East to Review trailhead · South";

/** Replaces the platform share APIs with recording adapters. `native` false means no Web Share, so the app copies. */
async function adapters(page: Page, native: boolean) {
  await page.addInitScript((native) => {
    const w = window as any;
    w.__mode = "reject";
    w.__sent = [] as string[];
    const settle = async () => {
      if (w.__mode === "abort")
        throw new DOMException("cancelled", "AbortError");
      if (w.__mode === "reject")
        throw new DOMException("refused", "NotAllowedError");
    };
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: native
        ? async (data: ShareData) => {
            w.__sent.push(data.text + "\n" + data.url);
            await settle();
          }
        : undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__sent.push(text);
          await settle();
        },
      },
    });
  }, native);
}
const setMode = (page: Page, mode: Mode) =>
  page.evaluate((m) => ((window as any).__mode = m), mode);
const sent = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).__sent);

const shareDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Share route", exact: true });
const summaryField = (page: Page) =>
  shareDialog(page).getByRole("textbox", { name: "Summary text", exact: true });

/** Reaches a control with Tab only, as a keyboard rider would. */
async function tabTo(page: Page, target: Locator, what: string, key = "Tab") {
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((e) => e === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  await expect(target, `${key} must reach ${what}`).toBeFocused();
}

/** Plans East → South with the real router and opens Share from the keyboard. */
async function planAndOpenShare(page: Page, save = false) {
  await page.goto("/?fixture");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(routePreview(page)).toBeVisible();
  if (save) {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Saved · View", exact: true }),
    ).toBeVisible();
  }
  await tabTo(
    page,
    page.getByRole("button", { name: "Share", exact: true }),
    "the route's Share button",
  );
  await page.keyboard.press("Enter");
  await expect(shareDialog(page)).toBeVisible();
  // Opening the dialog does not move focus into the summary.
  await expect(summaryField(page)).not.toBeFocused();
  return page.url();
}
const routePreview = (page: Page) =>
  page.getByRole("heading", { name: "Route preview", exact: true });

/** Tabs to the dialog's share/copy action and activates it with Enter. */
async function shareFromKeyboard(page: Page, name: string) {
  const action = shareDialog(page).getByRole("button", { name, exact: true });
  await tabTo(page, action, name);
  await page.keyboard.press("Enter");
  return action;
}

/**
 * The summary field holds exactly what the app handed the share/copy API, and nothing private: the field is reached by
 * keyboard, refuses typed keys, and Ctrl/Command+A selects the whole payload for the rider to copy themselves.
 */
async function expectManualCopy(page: Page, key = "Tab") {
  const field = summaryField(page);
  await tabTo(page, field, "the read-only summary text", key);
  // Visible where keyboard focus lands. (Checked now: Space in a read-only field is the browser's own "page down", so
  // the typed keys below may scroll the dialog without moving focus or changing the text.)
  await expect(field).toBeInViewport();
  const payload = (await sent(page)).at(-1)!;
  const origin = new URL(page.url()).origin;
  expect(payload).toMatch(
    /^Plan a trail ride with Trail Mapper\. A \d+\.\d mile ride\. Exact start and destination are not shared\.\n/,
  );
  expect(payload.split("\n")[1]).toBe(origin + "/");
  for (const secret of [
    "Review trailhead",
    SAVED_TITLE,
    "40.5",
    "40.49",
    "-88.",
    "?",
    "fixture",
    "#",
  ])
    expect(payload).not.toContain(secret);
  await expect(field).toHaveValue(payload);
  expect(
    await field.evaluate((e) => ({
      tag: e.tagName,
      readOnly: (e as HTMLTextAreaElement).readOnly,
      disabled: (e as HTMLTextAreaElement).disabled,
    })),
  ).toEqual({ tag: "TEXTAREA", readOnly: true, disabled: false });
  await expect(field).toHaveAccessibleDescription(
    "If sharing does not work, select this text and copy it yourself.",
  );
  // Select while the keyboard-focused field is still visible, before trying edits. Space in a read-only textarea
  // performs the browser's native page-down, so edit attempts deliberately come after the manual-copy proof.
  await page.keyboard.press("ControlOrMeta+a");
  expect(
    await field.evaluate((e) => {
      const t = e as HTMLTextAreaElement;
      return t.value.slice(t.selectionStart, t.selectionEnd);
    }),
  ).toBe(payload);
  await expect(field).toBeInViewport();
  for (const press of ["x", "Backspace", "Delete", "Enter", "ControlOrMeta+x"])
    await page.keyboard.press(press);
  await page.keyboard.type(" edited");
  await expect(field).toHaveValue(payload);
  await expect(field).toBeFocused();
  return payload;
}

/** The rest of the dialog is unchanged: privacy explanation, export choice and attribution notes stay. */
async function expectDialogIntact(page: Page) {
  const dialog = shareDialog(page);
  await expect(dialog).toContainText(
    "Exact start and destination, route coordinates and your recent history are excluded.",
  );
  await expect(dialog).toContainText("The file includes attribution.");
  await expect(dialog).toContainText("notices and data credit");
}

test("[engine] a refused native share leaves the exact private summary reachable by Tab and selectable, and a retry still shares", async ({
  page,
}) => {
  await adapters(page, true);
  const url = await planAndOpenShare(page, true);
  await shareFromKeyboard(page, "Share summary");
  await expect(shareDialog(page).getByRole("alert")).toHaveText(FAILED);
  // Onward Tab wraps through the dialog's own controls back to the summary.
  const payload = await expectManualCopy(page);
  await expect(shareDialog(page).getByRole("alert")).toHaveText(FAILED);
  await expectDialogIntact(page);

  await setMode(page, "ok");
  await shareFromKeyboard(page, "Share summary");
  await expect(shareDialog(page)).toHaveCount(0);
  expect(await sent(page)).toEqual([payload, payload]);
  await expect(routePreview(page)).toBeVisible();
  expect(page.url()).toBe(url);
});

test("[engine] a refused clipboard copy leaves the same summary to select by hand, and a retry still copies", async ({
  page,
}) => {
  await adapters(page, false);
  const url = await planAndOpenShare(page);
  await shareFromKeyboard(page, "Copy summary");
  await expect(shareDialog(page).getByRole("alert")).toHaveText(FAILED);
  const payload = await expectManualCopy(page);
  await expectDialogIntact(page);

  await setMode(page, "ok");
  await shareFromKeyboard(page, "Copy summary");
  await expect(shareDialog(page)).toHaveCount(0);
  await expect(
    page.getByText("Private summary copied", { exact: true }),
  ).toBeVisible();
  expect(await sent(page)).toEqual([payload, payload]);
  await expect(routePreview(page)).toBeVisible();
  expect(page.url()).toBe(url);
});

test("[engine] a cancelled share stays quiet, keeps the route and export choice, and the summary stays private with exact endpoints chosen", async ({
  page,
}) => {
  await adapters(page, true);
  const url = await planAndOpenShare(page);
  const exact = shareDialog(page).getByRole("checkbox", {
    name: /Include exact start and destination/,
  });
  await tabTo(page, exact, "the exact endpoints checkbox");
  await page.keyboard.press("Space");
  await expect(exact).toBeChecked();
  await setMode(page, "abort");
  await shareFromKeyboard(page, "Share summary");
  await expect.poll(async () => (await sent(page)).length).toBe(1);
  await expect(shareDialog(page).getByRole("alert")).toHaveText("");
  await expect(shareDialog(page).getByRole("status")).toHaveText("");
  // The export choice does not make the summary any less private.
  await expectManualCopy(page);
  await expect(exact).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(shareDialog(page)).toHaveCount(0);
  await expect(routePreview(page)).toBeVisible();
  expect(page.url()).toBe(url);
});

test("[engine] landscape large text: after a refused share the summary is reached by keyboard, scrolled into view and selectable", async ({
  page,
}) => {
  await adapters(page, true);
  await page.setViewportSize({ width: 640, height: 320 });
  await planAndOpenShare(page);
  await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  await shareFromKeyboard(page, "Share summary");
  await expect(shareDialog(page).getByRole("alert")).toHaveText(FAILED);
  // The summary is the stop just before the action, so Shift+Tab is the short way back.
  await expectManualCopy(page, "Shift+Tab");
  const box = (await summaryField(page).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});
