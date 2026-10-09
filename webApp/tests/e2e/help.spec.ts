import { test, expect, type Page } from "@playwright/test";

async function choose(
  page: Page,
  field: "Start" | "Destination",
  name: string,
) {
  await page
    .getByRole("button", { name: new RegExp("^" + field + ":") })
    .click();
  await page.getByRole("textbox", { name: "Search places" }).fill(name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(name) })
    .click();
}
async function plan(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
}
const helpButton = (page: Page) =>
  page.getByRole("button", { name: /^Help/ }).first();
const helpDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Help and about" });

test("Help and about is reachable from every main screen and names what a rider needs", async ({
  page,
}) => {
  await page.goto("/");
  for (const tab of ["Plan", "Saved", "Explore", "Updates"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(helpButton(page)).toBeVisible();
  }
  await helpButton(page).click();
  const dialog = helpDialog(page);
  await expect(dialog).toBeVisible();
  for (const heading of [
    "Before you ride",
    "Where it works",
    "What the map shows",
    "Finding places",
    "Your data and privacy",
    "Data sources and licenses",
    "About this build",
    "Report a problem",
  ])
    await expect(dialog.getByRole("heading", { name: heading })).toBeAttached();
  // Foreground-only, closures-not-live, mapped-vs-unverified and proposed status are all stated.
  await expect(dialog).toContainText(
    "only while this page stays open and visible",
  );
  await expect(dialog).toContainText("not a live feed");
  await expect(dialog).toContainText("Unverified connection");
  await expect(dialog).toContainText("Proposed · not built");
  await expect(dialog).toContainText("Do not ride it");
  // Build identity and dataset identity are shown.
  await expect(dialog).toContainText(/Build\s*[0-9a-f]{12}|Build\s*unknown/);
  await expect(dialog).toContainText("Synthetic review network");
});

test("Help follows today's behaviour: browser-only storage, optional basemap, no accounts or analytics, no phone claim", async ({
  page,
  context,
}) => {
  const requested = new Set<string>();
  page.on("request", (request) => requested.add(new URL(request.url()).host));
  await plan(page);
  await helpButton(page).click();
  const dialog = helpDialog(page);
  await expect(dialog).toContainText("Stored in this browser only");
  await expect(dialog).toContainText("tile.openstreetmap.org");
  await expect(dialog).toContainText("off by default");
  await expect(dialog).toContainText("no analytics, advertising or tracking");
  await expect(dialog).toContainText("Accounts and sync: not available");
  // The location claim is the qualified one: exact fixes are never uploaded, and this build fetches no road files.
  await expect(dialog).toContainText(
    "The app never uploads your exact GPS fixes, what you type or what you save",
  );
  const copy = await dialog.innerText();
  expect(copy).not.toContain("is not sent by the app anywhere");
  expect(copy).not.toContain("road files");
  expect([...requested].filter((url) => /access-/.test(url))).toEqual([]);
  await expect(dialog).toContainText(
    "not been verified on physical iPhone Safari or Android Chrome",
  );
  // Nothing that is not implemented is advertised.
  const text = (await dialog.innerText()).toLowerCase();
  for (const forbidden of [
    "sign in with google",
    "sign in with apple",
    "sync your",
    "works on iphone",
    "offline maps are available",
  ])
    expect(text).not.toContain(forbidden);
  // And the claims are true of this session: only this site was contacted, and no cookies were set.
  expect(
    [...requested].filter((host) => !/^127\.0\.0\.1|^localhost/.test(host)),
  ).toEqual([]);
  expect(await context.cookies()).toEqual([]);
  expect(requested.has("tile.openstreetmap.org")).toBe(false);
});

test("the dialog is keyboard-operable: focus goes in, Escape closes it and returns focus to Help", async ({
  page,
}) => {
  await page.goto("/");
  await helpButton(page).focus();
  await page.keyboard.press("Enter");
  const dialog = helpDialog(page);
  await expect(dialog).toBeVisible();
  const inside = await page.evaluate(() =>
    document.querySelector("dialog[open]")?.contains(document.activeElement),
  );
  expect(inside).toBe(true);
  // Tab stays trapped inside the dialog.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        document
          .querySelector("dialog[open]")
          ?.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(helpButton(page)).toBeFocused();
});

test("browser Back closes Help instead of leaving the screen, and Help never stops a ride in progress", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await helpButton(page).click();
  await expect(helpDialog(page)).toBeVisible();
  await page.goBack();
  await expect(helpDialog(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Saved", exact: true }),
  ).toBeVisible();
});

test("opening Help during a ride leaves the ride active", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const key = "trail-mapper.fixture:trail-mapper.web.active-ride.v1";
    if (localStorage.getItem(key)) return;
    const at = ([east, north]: [number, number]) => ({
      latitude: 40.5 + north / 111_195,
      longitude: -88.95 + east / (111_195 * Math.cos((40.5 * Math.PI) / 180)),
    });
    const points = (
      [
        [0, 0],
        [0, 1000],
        [0, 2000],
        [0, 1000],
        [0, 0],
      ] as [number, number][]
    ).map(at);
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        record: {
          key: "seeded",
          title: "Seeded loop",
          createdAt: Date.now(),
          usedAt: Date.now(),
          route: {
            segments: points.slice(1).map((end, i) => ({
              type: "Trail",
              points: [points[i], end],
              isRouted: true,
            })),
            totalDistanceMeters: 4000,
            ordinaryAccessDistanceMeters: 0,
            totalCost: 1,
            kind: "ExerciseLoop",
          },
          draft: {
            mode: "loop",
            start: { label: "Trailhead", ...points[0] },
            destination: null,
            miles: 3,
            proposed: false,
          },
        },
        routeProgressMeters: 500,
        creditedDistanceMeters: 500,
        updatedAt: Date.now(),
      }),
    );
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toBeVisible();
  await page.getByText("Ride details", { exact: true }).click();
  await expect(
    page.getByText("Keep this page open and visible. Guidance pauses"),
  ).toBeVisible();
  await helpButton(page).click();
  await expect(helpDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    localStorage.getItem(
      "trail-mapper.fixture:trail-mapper.web.active-ride.v1",
    ),
  );
  expect(stored).not.toBeNull();
});

test("the foreground-only limit is stated at navigation entry, tied to the Start button", async ({
  page,
}) => {
  await plan(page);
  const note = page.locator("#foreground-note");
  await expect(note).toContainText(
    "Keep this page open and visible while you ride",
  );
  await expect(note).toContainText(
    "no background tracking or offline navigation",
  );
  const start = page.getByRole("button", {
    name: "Start navigation",
    exact: true,
  });
  await expect(start).toHaveAttribute("aria-describedby", "foreground-note");
  // It sits directly above the button the rider presses, not only in Help.
  const order = await page.evaluate(() => {
    const n = document.getElementById("foreground-note")!;
    const b = document.querySelector(
      'button[aria-describedby="foreground-note"]',
    )!;
    return !!(n.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
});

test("place search says it is a small catalog and offers map, location and saved-place fallbacks", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  const chooser = page.getByRole("dialog");
  await expect(chooser).toContainText("Not an address or business search");
  await expect(chooser).toContainText("6 public places");
  await chooser
    .getByRole("textbox", { name: "Search places" })
    .fill("742 Evergreen Terrace");
  await expect(chooser).toContainText("No matching place");
  await expect(chooser).toContainText("only knows 6 public places");
  await expect(
    chooser.getByRole("button", { name: "Pick on map" }),
  ).toBeVisible();
  await expect(
    chooser.getByRole("button", { name: "Use current location" }),
  ).toBeVisible();
  await expect(chooser).toContainText("places you saved");
});

test("a problem report holds only the app version, can be reviewed and edited, and sends nothing", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await plan(page);
  // Give the app things a careless report might leak: a saved route, a saved place, a recent ride.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("More actions", { exact: true }).click();
  await page
    .getByRole("button", { name: "Save destination as a place" })
    .click();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await helpButton(page).click();
  await helpDialog(page)
    .getByRole("button", { name: "Write a problem report" })
    .click();
  const report = page.getByRole("dialog", { name: "Report a problem" });
  const box = report.getByRole("textbox", { name: "Report text" });
  const value = await box.inputValue();
  expect(value).toContain("Trail Mapper problem report");
  expect(value).toMatch(/Build: /);
  expect(value).toMatch(/Data: Synthetic review network/);
  // No location, no label of any place or route, no coordinates, no history, no account.
  expect(value).not.toMatch(/-?\d{2,3}\.\d{3,}/);
  expect(value).not.toMatch(/Review trailhead|Culver|Seeded|@|Mozilla/i);
  // Optional browser line appears in the text, visibly, and goes away again.
  const browser = report.getByRole("checkbox", { name: /Add my browser/ });
  await browser.check();
  expect(await box.inputValue()).toMatch(/Browser and screen: /);
  await browser.uncheck();
  expect(await box.inputValue()).not.toMatch(/Browser and screen: /);
  // The rider's own edits are kept and copied exactly.
  await box.fill(value + "\nThe map would not load.");
  await report.getByRole("button", { name: "Copy report" }).click();
  await expect(report.getByRole("status")).toContainText("Report copied");
  // Some platforms hand the clipboard back with CRLF line breaks.
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
  ).toBe(value + "\nThe map would not load.");
  // The only way off the page is a link the rider chooses; nothing was requested while reviewing and copying.
  expect(requests).toEqual([]);
  await expect(
    report.getByRole("link", { name: /public issue form/ }),
  ).toHaveAttribute(
    "href",
    "https://github.com/hooware-ai/constitution-trail-mapper/issues/new",
  );
  await expect(report).toContainText("anything you post is public");
  // Back returns to the help topics with focus on the new view.
  await report.getByRole("button", { name: /Back to help/ }).click();
  await expect(helpDialog(page)).toBeVisible();
});

test("on a narrow screen with large text nothing is cut off or off-screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect(helpButton(page)).toBeVisible();
  const pageOverflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  const before = await pageOverflow();
  const box = await helpButton(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320 + 1);
  await helpButton(page).click();
  const dialog = helpDialog(page);
  await expect(dialog).toBeVisible();
  const overflow = await dialog.evaluate((el) => ({
    horizontal: el.scrollWidth - el.clientWidth,
    page:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }));
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  // Opening Help adds no sideways scrolling to the page behind it.
  expect(await pageOverflow()).toBeLessThanOrEqual(before + 1);
  // The close control is reachable without scrolling the dialog.
  await expect(
    dialog.getByRole("button", { name: "Close Help and about" }),
  ).toBeInViewport();
  // The content is long, so the dialog scrolls inside itself and the last section can be reached.
  const last = dialog.getByRole("button", { name: "Write a problem report" });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});

test("Help and the report view have no automatically detectable accessibility violations", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.goto("/");
  await helpButton(page).click();
  await expect(helpDialog(page)).toBeVisible();
  const help = await new AxeBuilder({ page }).include("dialog[open]").analyze();
  expect(help.violations.map((v) => `${v.id}: ${v.nodes[0].html}`)).toEqual([]);
  await helpDialog(page)
    .getByRole("button", { name: "Write a problem report" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Report a problem" }),
  ).toBeVisible();
  const report = await new AxeBuilder({ page })
    .include("dialog[open]")
    .analyze();
  expect(report.violations.map((v) => `${v.id}: ${v.nodes[0].html}`)).toEqual(
    [],
  );
});

// A clipboard whose promises the test settles by hand, to exercise slow and overlapping copy attempts.
async function controllableClipboard(page: Page) {
  await page.addInitScript(() => {
    const copies: Array<{
      text: string;
      resolve: () => void;
      reject: (e: Error) => void;
    }> = [];
    (window as any).__copies = copies;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) =>
          new Promise<void>((resolve, reject) =>
            copies.push({ text, resolve, reject }),
          ),
      },
    });
  });
}
const settle = (page: Page, index: number, how: "resolve" | "reject") =>
  page.evaluate(
    ([i, h]) => {
      const copy = (window as any).__copies[i as number];
      return h === "resolve"
        ? copy.resolve()
        : copy.reject(new Error("denied"));
    },
    [index, how] as const,
  );
const pendingCopies = (page: Page) =>
  page.evaluate(() => (window as any).__copies.length as number);
async function openReport(page: Page) {
  // From the page, open Help first; from inside Help (after Back) the topics are already showing.
  if (!(await helpDialog(page).isVisible())) await helpButton(page).click();
  await helpDialog(page)
    .getByRole("button", { name: "Write a problem report" })
    .click();
  return page.getByRole("dialog", { name: "Report a problem" });
}
const selectedLength = (report: ReturnType<Page["getByRole"]>) =>
  report
    .getByRole("textbox", { name: "Report text" })
    .evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart);

test("a slow clipboard failure from a report the rider left cannot speak for the next report", async ({
  page,
}) => {
  await controllableClipboard(page);
  await page.goto("/");
  let report = await openReport(page);
  await report.getByRole("button", { name: "Copy report" }).click();
  await expect.poll(() => pendingCopies(page)).toBe(1);
  await report.getByRole("button", { name: /Back to help/ }).click();
  report = await openReport(page);
  await settle(page, 0, "reject");
  await page.waitForTimeout(200);
  await expect(report.getByRole("alert")).toHaveText("");
  await expect(report.getByRole("status")).toHaveText("");
  // And it did not select the new report's text on the old attempt's behalf.
  expect(await selectedLength(report)).toBe(0);
});

test("a slow clipboard success from a report the rider left does not claim the next report was copied", async ({
  page,
}) => {
  await controllableClipboard(page);
  await page.goto("/");
  let report = await openReport(page);
  await report.getByRole("button", { name: "Copy report" }).click();
  await expect.poll(() => pendingCopies(page)).toBe(1);
  await report.getByRole("button", { name: /Back to help/ }).click();
  report = await openReport(page);
  await settle(page, 0, "resolve");
  await page.waitForTimeout(200);
  await expect(report.getByRole("status")).toHaveText("");
  await expect(report.getByRole("alert")).toHaveText("");
});

test("overlapping copy attempts: only the latest one reports, whichever order they settle in", async ({
  page,
}) => {
  await controllableClipboard(page);
  await page.goto("/");
  const report = await openReport(page);
  const copy = report.getByRole("button", { name: "Copy report" });
  await copy.click();
  await copy.click();
  await expect.poll(() => pendingCopies(page)).toBe(2);
  // The older attempt failing, or succeeding, late says nothing and selects nothing.
  await settle(page, 0, "reject");
  await page.waitForTimeout(200);
  await expect(report.getByRole("alert")).toHaveText("");
  expect(await selectedLength(report)).toBe(0);
  // The latest attempt decides.
  await settle(page, 1, "resolve");
  await expect(report.getByRole("status")).toContainText("Report copied");
  // Older attempts settling afterwards still change nothing.
  await copy.click();
  await expect.poll(() => pendingCopies(page)).toBe(3);
  await settle(page, 2, "reject");
  await expect(report.getByRole("alert")).toContainText(
    "did not allow copying",
  );
  await expect(report.getByRole("status")).toHaveText("");
});

test("normal copy and the fallback still work and are announced again when the same message repeats", async ({
  page,
}) => {
  await controllableClipboard(page);
  await page.goto("/");
  const report = await openReport(page);
  const copy = report.getByRole("button", { name: "Copy report" });
  // Watch what a screen reader would see: the status text must go empty before it repeats.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as any).__statusSeen = seen;
    const node = document.querySelector('dialog[open] [role="status"]')!;
    new MutationObserver(() => seen.push(node.textContent ?? "")).observe(
      node,
      {
        childList: true,
        characterData: true,
        subtree: true,
      },
    );
  });
  await copy.click();
  await expect.poll(() => pendingCopies(page)).toBe(1);
  await settle(page, 0, "resolve");
  await expect(report.getByRole("status")).toContainText("Report copied");
  await copy.click();
  await expect.poll(() => pendingCopies(page)).toBe(2);
  await settle(page, 1, "resolve");
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => (window as any).__statusSeen as string[])
        ).filter((text) => text.includes("Report copied")).length,
    )
    .toBe(2);
  const seen = await page.evaluate(
    () => (window as any).__statusSeen as string[],
  );
  // Between the two identical messages the region was emptied.
  const first = seen.findIndex((text) => text.includes("Report copied"));
  const second = seen.findIndex(
    (text, i) => i > first && text.includes("Report copied"),
  );
  expect(seen.slice(first + 1, second)).toContain("");
  // Failure: the message appears and the text is selected for the rider to copy by hand.
  await copy.click();
  await expect.poll(() => pendingCopies(page)).toBe(3);
  await settle(page, 2, "reject");
  await expect(report.getByRole("alert")).toContainText("The text is selected");
  expect(await selectedLength(report)).toBeGreaterThan(50);
});

test("Trail updates lists the October notices with official links that open safely, their source and check date, and statuses that follow the clock", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Updates", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trail updates" }),
  ).toBeVisible();
  await expect(page.locator(".freshness")).toContainText(
    "selected entries updated October 9, 2026",
  );
  const card = (title: string) =>
    page.locator(".updates-list article", { hasText: title });
  const now = Date.now();
  const at = (iso: string) => Date.parse(iso);
  const willow = card("Willow Street trail crossing: Locust to Cypress");
  await expect(willow.locator(".update-status")).toHaveText(
    now >= at("2026-10-19T22:00:00Z")
      ? "Recheck needed"
      : now >= at("2026-10-05T11:00:00Z")
        ? "Closed since October 5 · estimated through October 19; reopening not confirmed"
        : "Scheduled · closure begins October 5, 6 a.m.",
  );
  const camelback = card("Virginia Avenue trail crossing (Camelback Bridge)");
  await expect(camelback.locator(".update-status")).toHaveText(
    now >= at("2026-10-06T22:00:00Z")
      ? "Recheck needed"
      : now >= at("2026-10-05T13:00:00Z")
        ? "Closed at Virginia Avenue since October 5 · estimated through October 6; reopening not confirmed"
        : "Scheduled · closure begins October 5, 8 a.m.",
  );
  const raab = card("Constitution Trail paving: Raab Road");
  await expect(raab.locator(".update-status")).toHaveText(
    now >= at("2026-10-07T05:00:00Z")
      ? "Recheck needed"
      : now >= at("2026-10-03T11:00:00Z")
        ? "Paving under way · temporary closures; trail sections and end not published"
        : "Scheduled · paving begins October 3, 2026",
  );
  // Raab says what it does not know, and marks no trail barrier.
  await expect(raab).toContainText("does not say which trail sections close");
  for (const [article, href] of [
    [willow, "https://www.normalil.gov/m/newsflash/home/detail/3356"],
    [camelback, "https://www.normalil.gov/m/newsflash/Home/Detail/3353"],
    [raab, "https://www.normalil.gov/m/newsflash/Home/Detail/3357"],
  ] as const) {
    const link = article.getByRole("link");
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }
  // The Hamilton notice carries the official map's estimate and still says an estimate is not a reopening.
  await expect(card("Hamilton / Rhodes connection")).toContainText(
    "estimates completion at 6 p.m. CDT on October 31, 2026",
  );
  await expect(card("Hamilton / Rhodes connection")).toContainText(
    "an estimate does not confirm reopening",
  );
});
