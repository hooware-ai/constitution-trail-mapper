// Reverse direction must be reachable by a real pointer on a loop preview, including the short landscape layout whose
// Start dock sticks to the bottom of the scrolling panel. Run unchanged by the Chromium (tests/e2e) and WebKit
// (tests/webkit) suites against the real app, worker and Kotlin router on the synthetic fixture graph; no router or app
// state is substituted. Clicks are Playwright's ordinary actionable clicks (its own scroll-into-view and hit-target
// check, never `force`). These are engine results only, not physical-device acceptance.
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { choose } from "../webkit/support";

type Stored = { key: string; title: string; plannedKey?: string };

const SESSION = "trail-mapper.fixture:trail-mapper.web.session.v1";

const sessionSelected = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null")?.selected ?? null,
    SESSION,
  ) as Promise<Stored | null>;

/** Rects of the controls, the panel's scrolling geometry and what is hit-tested at each control's centre. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const rect = (e: Element | null) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const reverse = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Reverse direction",
    )!;
    const start = document.querySelector(".start-dock .primary")!;
    const hit = (e: Element) => {
      const r = e.getBoundingClientRect();
      const at = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return at === e || e.contains(at)
        ? "self"
        : at
          ? `${at.tagName.toLowerCase()}.${at.className} in ${at.closest(".start-dock") ? ".start-dock" : "other"}`
          : "nothing";
    };
    const scrollers: object[] = [];
    for (let e: Element | null = reverse; e; e = e.parentElement) {
      const style = getComputedStyle(e);
      if (
        /auto|scroll/.test(style.overflowY) ||
        e === document.scrollingElement
      )
        scrollers.push({
          element: `${e.tagName.toLowerCase()}.${e.className}`,
          scrollTop: e.scrollTop,
          scrollHeight: e.scrollHeight,
          clientHeight: e.clientHeight,
          scrollPaddingBottom: style.scrollPaddingBottom,
        });
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      rootFont: getComputedStyle(document.documentElement).fontSize,
      header: rect(document.querySelector(".app > header")),
      panel: rect(document.querySelector(".panel")),
      dock: rect(document.querySelector(".start-dock")),
      dockPosition: getComputedStyle(document.querySelector(".start-dock")!)
        .position,
      reverse: rect(reverse),
      start: rect(start),
      reverseHit: hit(reverse),
      startHit: hit(start),
      scrollers,
    };
  });

type Geometry = Awaited<ReturnType<typeof geometry>>;

const record = async (testInfo: TestInfo, name: string, value: Geometry) => {
  console.log(`${testInfo.title} ${name}: ${JSON.stringify(value)}`);
  await testInfo.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
};

/** The real pointer press's target, recorded in the capture phase (before the app handles it). */
function recordPointerTargets() {
  const w = window as any;
  w.__pointerTargets = [];
  document.addEventListener(
    "pointerdown",
    (event) => {
      const button = (event.target as Element).closest("button");
      w.__pointerTargets.push(button?.textContent ?? null);
    },
    true,
  );
}

const lastPointerTarget = (page: Page) =>
  page.evaluate(() => (window as any).__pointerTargets.at(-1) ?? null);

/** Clicks with the real pointer; on failure the geometry Playwright left behind is preserved before rethrowing. */
async function pointerClick(page: Page, testInfo: TestInfo, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  const failure = await button.click({ timeout: 15_000 }).then(
    () => null,
    (error: Error) => error,
  );
  if (failure) {
    await record(
      testInfo,
      `${name} click failure geometry`,
      await geometry(page),
    );
    await testInfo.attach(`${name} click failure`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    throw failure;
  }
  expect(await lastPointerTarget(page)).toBe(name);
}

/** After an actual click, the control's centre must be its own, outside the dock, and inside the visible panel. */
const expectHitTestable = (g: Geometry, control: "reverse" | "start") => {
  expect(g[`${control}Hit`]).toBe("self");
  const r = g[control]!;
  expect(r.top).toBeGreaterThanOrEqual(g.panel!.top - 1);
  expect(r.bottom).toBeLessThanOrEqual(
    Math.min(g.panel!.bottom, g.viewport.height) + 1,
  );
  if (control === "reverse" && g.dockPosition === "sticky")
    expect(r.bottom <= g.dock!.top + 1 || r.top >= g.dock!.bottom - 1).toBe(
      true,
    );
};

for (const [name, width, height, font] of [
  ["portrait", 390, 844, "100%"],
  ["portrait 200%", 390, 844, "200%"],
  ["short landscape", 640, 320, "100%"],
  ["short landscape 150%", 640, 320, "150%"],
  ["short landscape 200%", 640, 320, "200%"],
  ["adjacent landscape 200%", 640, 360, "200%"],
  ["taller landscape 200%", 640, 420, "200%"],
] as const) {
  test(`[engine] Reverse direction is pointer-clickable on a loop preview in ${name}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await page.addInitScript((font) => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.fontSize = font;
      });
    }, font);
    await page.addInitScript(recordPointerTargets);
    await page.goto("/");
    await page.getByRole("button", { name: /Make an exercise loop/ }).click();
    await choose(page, "Start", "Review trailhead · East");
    await page.getByRole("button", { name: "5 mi", exact: true }).click();
    await page.getByRole("button", { name: "Make loop", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Route preview", exact: true }),
    ).toBeVisible();
    const direction = page.locator(".direction-control span");
    await expect(direction).toHaveText("Planned direction");
    await expect.poll(() => sessionSelected(page)).not.toBeNull();
    const planned = (await sessionSelected(page))!;
    expect(planned.plannedKey).toBeUndefined();
    await record(testInfo, "initial geometry", await geometry(page));

    // Reverse through the real worker and router: the route key changes and the planned identity is kept.
    await pointerClick(page, testInfo, "Reverse direction");
    await record(testInfo, "reverse clicked geometry", await geometry(page));
    expectHitTestable(await geometry(page), "reverse");
    await expect(direction).toHaveText("Riding in reverse");
    await expect
      .poll(() => sessionSelected(page))
      .toMatchObject({ plannedKey: planned.key });
    const reversed = (await sessionSelected(page))!;
    expect(reversed.key).not.toBe(planned.key);
    await testInfo.attach("reversed", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    // Reversing back restores the planned identity exactly.
    const reverseButton = page.getByRole("button", {
      name: "Reverse direction",
      exact: true,
    });
    await expect(reverseButton).toBeEnabled();
    await pointerClick(page, testInfo, "Reverse direction");
    expectHitTestable(await geometry(page), "reverse");
    await expect(direction).toHaveText("Planned direction");
    await expect
      .poll(() => sessionSelected(page))
      .toMatchObject({ key: planned.key });
    expect((await sessionSelected(page))!.plannedKey).toBeUndefined();

    // Start stays reachable: a real pointer reaches it (hover runs the same scroll and hit-target check as a click,
    // without starting a ride), and so does any reason it is blocked.
    const start = page.getByRole("button", {
      name: "Start navigation",
      exact: true,
    });
    await start.hover({ timeout: 15_000 });
    expectHitTestable(await geometry(page), "start");
    if (await page.locator("#start-reason").count())
      await expect(page.locator("#start-reason")).toBeInViewport({ ratio: 1 });
    await page.locator(".leaflet-control-attribution a").first().hover();
    await expect(page.locator(".leaflet-control-attribution")).toBeInViewport();

    // In short landscape Start keeps sticking within the panel mid-scroll (as tests/support/previewLayout.ts checks at
    // 150%). At 200% in the cramped 320 and 360 heights the panel is too short for a sticky dock, which stays in the
    // flow instead; at 420 it sticks again.
    if (width >= 500 && height <= 500)
      expect((await geometry(page)).dockPosition).toBe(
        font === "200%" && height <= 360 ? "static" : "sticky",
      );
    if (width >= 500 && height <= 500 && !(font === "200%" && height <= 360)) {
      await page.locator(".panel").evaluate((panel) => {
        panel.scrollTop = (panel.scrollHeight - panel.clientHeight) / 2;
      });
      await expect(start).toBeInViewport({ ratio: 1 });
      const mid = await geometry(page);
      await record(testInfo, "mid-scroll geometry", mid);
      expect(mid.start!.top).toBeGreaterThanOrEqual(mid.panel!.top);
      expect(mid.start!.bottom).toBeLessThanOrEqual(mid.panel!.bottom);
      expect(mid.startHit).toBe("self");
    }
    expect(errors).toEqual([]);
  });
}

// Resizing across the static/sticky threshold at 200% re-lays out the same preview; each height keeps Reverse and Start
// reachable by the real pointer.
test("[engine] Reverse direction stays pointer-clickable while short landscape 200% resizes 320, 360, 420, 320", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 640, height: 320 });
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.fontSize = "200%";
    });
  });
  await page.addInitScript(recordPointerTargets);
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  await choose(page, "Start", "Review trailhead · East");
  await page.getByRole("button", { name: "5 mi", exact: true }).click();
  await page.getByRole("button", { name: "Make loop", exact: true }).click();
  const direction = page.locator(".direction-control span");
  await expect(direction).toHaveText("Planned direction");
  const start = page.getByRole("button", {
    name: "Start navigation",
    exact: true,
  });
  let reversed = false;
  for (const height of [320, 360, 420, 320]) {
    await page.setViewportSize({ width: 640, height });
    await expect
      .poll(async () => (await geometry(page)).dockPosition)
      .toBe(height <= 360 ? "static" : "sticky");
    await pointerClick(page, testInfo, "Reverse direction");
    reversed = !reversed;
    const g = await geometry(page);
    await record(testInfo, `${height} reverse clicked geometry`, g);
    expectHitTestable(g, "reverse");
    await expect(direction).toHaveText(
      reversed ? "Riding in reverse" : "Planned direction",
    );
    await start.hover({ timeout: 15_000 });
    expectHitTestable(await geometry(page), "start");
  }
  expect(errors).toEqual([]);
});
