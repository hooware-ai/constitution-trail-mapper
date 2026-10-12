import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startAndHelpAreReachable } from "../support/start-help-dock";
import { installLayoutTests } from "../support/installLayout";

const android =
  "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/154.0.0.0 Mobile Safari/537.36";
test.use({ userAgent: android });
const action = (page: Page) => page.locator(".install-button");

installLayoutTests();

async function detection(
  page: Page,
  mode: "unknown" | "installed" | "other" | "failed" | "held" | "throw",
) {
  await page.addInitScript((mode) => {
    const w = window as any;
    const result =
      mode === "installed"
        ? [
            {
              platform: "webapp",
              url: location.origin + "/manifest.webmanifest",
            },
          ]
        : mode === "other"
          ? [
              {
                platform: "webapp",
                url: "https://other.example/manifest.webmanifest",
              },
              { platform: "play", id: "com.trailmapper" },
            ]
          : [];
    Object.defineProperty(navigator, "getInstalledRelatedApps", {
      configurable: true,
      value: () => {
        if (mode === "throw") throw new Error("Unavailable");
        if (mode === "failed") return Promise.reject(new Error("Unavailable"));
        if (mode === "held")
          return new Promise((resolve) => {
            w.releaseDetection = (installed = false) =>
              resolve(
                installed
                  ? [
                      {
                        platform: "webapp",
                        url: location.origin + "/manifest.webmanifest",
                      },
                    ]
                  : [],
              );
          });
        return Promise.resolve(result);
      },
    });
    w.sendPrompt = (outcome = "dismissed", fail = false) => {
      const event = new Event("beforeinstallprompt", {
        cancelable: true,
      }) as any;
      event.prompt = () => {
        w.promptCalls = (w.promptCalls ?? 0) + 1;
        return fail
          ? Promise.reject(new Error("Not available"))
          : Promise.resolve();
      };
      event.userChoice = Promise.resolve({ outcome });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    w.holdPrompt = () => {
      const event = new Event("beforeinstallprompt", {
        cancelable: true,
      }) as any;
      event.prompt = () =>
        new Promise((_, reject) => {
          w.rejectPrompt = () => reject(new Error("Late failure"));
        });
      event.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(event);
    };
  }, mode);
}

test("unknown detection offers working Chrome guidance; Help is last and returns focus", async ({
  page,
}) => {
  await detection(page, "unknown");
  await page.goto("/");
  await expect(action(page)).toHaveText("Install");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  // Keyboard activation also focuses the opener on WebKit, whose mouse clicks do not focus buttons.
  await action(page).press("Enter");
  const guide = page.getByRole("dialog", { name: "Install Trail Mapper" });
  await expect(guide).toContainText("Add to Home screen");
  await expect(guide).toContainText("could not confirm");
  await expect(guide).toContainText("does not add offline");
  await page.keyboard.press("Escape");
  await expect(action(page)).toBeFocused();
  const help = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button")
    .last();
  await expect(help).toHaveAccessibleName("Help and about");
  await expect(
    page.locator(".app-header").getByRole("button", { name: /^Help/ }),
  ).toHaveCount(0);
  await help.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Help and about" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
});

test("confirmed self-PWA offers honest Open guidance with no navigation; other apps do not count", async ({
  page,
}) => {
  await detection(page, "installed");
  await page.goto("/");
  await expect(action(page)).toHaveText("Open");
  const url = page.url();
  await action(page).click();
  await expect(
    page.getByRole("dialog", { name: "Open Trail Mapper" }),
  ).toContainText("Home Screen");
  expect(page.url()).toBe(url);
  await page.keyboard.press("Escape");
  // Another origin's PWA or installed native Android app must not become a confirmed self-PWA.
  await detection(page, "other");
  await page.reload();
  await expect(action(page)).toHaveText("Install");
});

test("a retained prompt runs once on tap, dismisses safely, and appinstalled wins a late query", async ({
  page,
}) => {
  await detection(page, "held");
  await page.goto("/");
  await expect(action(page)).toHaveText("Checking…");
  await expect(action(page)).toBeDisabled();
  const firstBox = await action(page).boundingBox();
  expect(await page.evaluate(() => (window as any).sendPrompt())).toBe(true);
  await expect(action(page)).toHaveText("Install");
  const readyBox = await action(page).boundingBox();
  expect(readyBox?.height).toBe(firstBox?.height);
  expect(readyBox?.width).toBe(firstBox?.width);
  expect(await page.evaluate(() => (window as any).promptCalls ?? 0)).toBe(0);
  await action(page).click();
  await expect(action(page)).toBeEnabled();
  expect(await page.evaluate(() => (window as any).promptCalls)).toBe(1);
  await action(page).click();
  await expect(
    page.getByRole("dialog", { name: "Install Trail Mapper" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).promptCalls)).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("appinstalled"));
    (window as any).releaseDetection();
  });
  await expect(action(page)).toHaveText("Open");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("accepted prompt waits for appinstalled; a rejected prompt and detection failures remain usable", async ({
  page,
}) => {
  for (const mode of ["failed", "throw"] as const) {
    await detection(page, mode);
    await page.goto("/");
    await expect(action(page)).toHaveText("Install");
  }
  await page.evaluate(() => (window as any).sendPrompt("accepted"));
  await action(page).click();
  await expect(action(page)).toHaveText("Install");
  await page.evaluate(() => (window as any).sendPrompt("dismissed", true));
  await action(page).click();
  await expect(
    page.getByRole("dialog", { name: "Install Trail Mapper" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(action(page)).toBeEnabled();
});

test("slow query settles to unknown and stays useful for a later prompt", async ({
  page,
}) => {
  await page.clock.install();
  await detection(page, "held");
  await page.goto("/");
  await expect(action(page)).toHaveText("Checking…");
  await page.clock.runFor(3100);
  await expect(action(page)).toHaveText("Install");
  await page.evaluate(() => (window as any).sendPrompt());
  await action(page).click();
  expect(await page.evaluate(() => (window as any).promptCalls)).toBe(1);
});

test("standalone hides installation but keeps Help", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = original(query);
      if (query === "(display-mode: standalone)")
        Object.defineProperty(result, "matches", { value: true });
      return result;
    };
  });
  await page.goto("/");
  await expect(action(page)).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button")
      .last(),
  ).toHaveAccessibleName("Help and about");
});

test("non-Android hides installation but keeps the final Help tab", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154.0.0.0",
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(action(page)).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button")
      .last(),
  ).toHaveAccessibleName("Help and about");
  await context.close();
});

test("installation confirmation defeats a pending prompt's late failure", async ({
  page,
}) => {
  for (const confirmation of ["event", "query"]) {
    await detection(page, "held");
    await page.goto("/");
    await expect(action(page)).toHaveText("Checking…");
    await page.evaluate(() => (window as any).holdPrompt());
    await action(page).click();
    await expect(action(page)).toHaveText("Installing…");
    await page.evaluate((confirmation) => {
      if (confirmation === "event")
        window.dispatchEvent(new Event("appinstalled"));
      else (window as any).releaseDetection(true);
    }, confirmation);
    await expect(action(page)).toHaveText("Open");
    await expect(action(page)).toBeEnabled();
    await page.evaluate(() => (window as any).rejectPrompt());
    await expect(action(page)).toHaveText("Open");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("header and five bottom actions fit narrow, rotated and enlarged screens; guides are accessible", async ({
  page,
}) => {
  await detection(page, "unknown");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(action(page)).toHaveText("Install");
  for (const view of [
    { width: 320, height: 720 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(view);
    for (const font of ["16px", "32px"]) {
      await page.evaluate((font) => {
        document.documentElement.style.fontSize = font;
      }, font);
      const boxes = await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const box = button.getBoundingClientRect();
            return {
              x: box.x,
              right: box.right,
              y: box.y,
              width: box.width,
              height: box.height,
            };
          }),
        );
      expect(boxes).toHaveLength(5);
      expect(
        boxes.every(
          (box) =>
            box.width >= 44 &&
            box.height >= 44 &&
            box.x >= 0 &&
            box.right <= view.width,
        ),
      ).toBe(true);
      expect(boxes.every((box) => box.y === boxes[0].y)).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "16px";
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await action(page).click();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});

test("Help remains reachable from the planner and preview without interrupting route choices", async ({
  page,
}) => {
  await detection(page, "unknown");
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /^Help/ })
    .click();
  await page.keyboard.press("Escape");
  for (const [field, name] of [
    ["Start", "Review trailhead · East"],
    ["Destination", "Review trailhead · South"],
  ]) {
    await page
      .getByRole("button", { name: new RegExp("^" + field + ":") })
      .click();
    await page.getByRole("textbox", { name: "Search places" }).fill(name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(name) })
      .click();
  }
  await page.getByRole("button", { name: "Find route", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Route preview", exact: true }),
  ).toBeVisible();
  await page.locator(".start-dock-help").click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeEnabled();
});

for (const view of [
  { width: 390, height: 844 },
  { width: 320, height: 720 },
  { width: 844, height: 390 },
]) {
  test(`Start and Help have separate reachable targets at ${view.width}x${view.height}`, async ({
    page,
  }) => {
    await startAndHelpAreReachable(page, view);
  });
}
test("Start and Help remain reachable with 200% text on a narrow phone", async ({
  page,
}) => {
  await startAndHelpAreReachable(page, { width: 320, height: 720 }, true);
});

test("Help cannot cover the map-picker confirmation at 200% text with wide letters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  await page.addStyleTag({ content: "*{letter-spacing:0.4em !important}" });
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).click();
  await page.getByRole("button", { name: "Pick on map", exact: true }).click();
  const use = page.getByRole("button", { name: "Use map center", exact: true });
  await use.scrollIntoViewIfNeeded();
  expect(
    await use.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return element === hit || element.contains(hit);
    }),
  ).toBe(true);
  await use.click();
  await expect(page.getByRole("button", { name: /^Start:/ })).not.toContainText(
    "Choose a place",
  );
});

for (const mode of ["unknown", "installed"] as const) {
  test(`browser Back closes ${mode} installation guidance without leaving the planner`, async ({
    page,
  }) => {
    await detection(page, mode);
    await page.goto("/");
    await page.getByRole("button", { name: /Go somewhere/ }).click();
    await expect(
      page.getByRole("heading", { name: "Go somewhere", exact: true }),
    ).toBeVisible();
    const before = await page
      .getByRole("button", { name: /^Start:/ })
      .getAttribute("aria-label");
    await expect(action(page)).toBeEnabled();
    await expect(action(page)).toHaveAccessibleName(
      mode === "installed" ? "Open Trail Mapper from Home Screen" : "Install",
    );
    await action(page).click();
    await expect(
      page.getByRole("dialog", {
        name:
          mode === "installed" ? "Open Trail Mapper" : "Install Trail Mapper",
        exact: true,
      }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Go somewhere", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Start:/ }),
    ).toHaveAccessibleName(before!);
    await expect(action(page)).toBeFocused();
  });
}
