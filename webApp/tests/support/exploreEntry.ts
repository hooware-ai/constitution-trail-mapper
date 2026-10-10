import { test, expect } from "@playwright/test";
import { choose, openPlanner, fitsWidth } from "../webkit/support";

const key = "trail-mapper.fixture:trail-mapper.web.session.v1";

test("[engine] a confirmed Explore pin changes only the chosen endpoint and uses normal route checks", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Observe real worker responses; do not supply geometry or route results.
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.result?.point && typeof data.result?.label === "string")
            (window as any).__exploreResolved = data.result;
          if (data.result?.instructions)
            (window as any).__exploreRoute = data.result;
        });
      }
    } as typeof Worker;
  });
  await openPlanner(page);
  await choose(page, "Start", "Review trailhead · East");
  await choose(page, "Destination", "Review trailhead · South");
  await page.getByRole("checkbox", { name: /Include proposed trails/ }).check();
  await expect
    .poll(() =>
      page.evaluate(
        (k) => JSON.parse(localStorage.getItem(k) ?? "null")?.draft?.proposed,
        key,
      ),
    )
    .toBe(true);
  const before = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k)!).draft,
    key,
  );
  const explore = async () => {
    await page
      .getByRole("button", { name: "Trail Mapper home", exact: true })
      .click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Explore", exact: true })
      .click();
  };
  const entry = () =>
    page
      .getByRole("button", { name: "Choose a ride point", exact: true })
      .click();
  await explore();
  await entry();
  await expect(
    page.getByRole("button", { name: "Plan from here", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".explore-point-marker")).toHaveCount(0);
  // Explicit keyboard selection at the current map center is available without tapping geometry.
  await page
    .getByRole("region", { name: /Interactive map/ })
    .press("ArrowLeft");
  await page
    .getByRole("button", { name: "Use map center", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Selected ride point", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".explore-point-marker")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Cancel map selection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trails around you", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".explore-point-marker")).toHaveCount(0);
  // Browser Back/Forward cannot reinstate a pending pin or write it to the draft.
  await entry();
  await page
    .getByRole("button", { name: "Use map center", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Plan from here", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Trails around you", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Trails around you", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".explore-point-marker")).toHaveCount(0);
  // Explore deliberately does not persist the in-memory draft. Verify it after returning to the actual planner.
  let expectedDraft = before;
  // Both explicit confirmations preserve the other endpoint and preferences.
  for (const [action, target, other] of [
    ["Plan from here", "start", "destination"],
    ["Plan to here", "destination", "start"],
  ] as const) {
    await entry();
    await page
      .getByRole("button", { name: "Use map center", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: action, exact: true }),
    ).toBeVisible();
    const resolved = await page.evaluate(
      () => (window as any).__exploreResolved,
    );
    const draftBefore = expectedDraft;
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Find route", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).draft, key),
      )
      .toEqual({
        ...draftBefore,
        mode: "point",
        [target]: { ...resolved.point, label: resolved.label },
      });
    const made = await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k)!).draft,
      key,
    );
    expect(made[other]).toEqual(draftBefore[other]);
    expectedDraft = made;
    await expect(
      page.getByRole("checkbox", { name: /Include proposed trails/ }),
    ).toBeChecked();
    if (target === "start") {
      await page
        .getByRole("button", { name: "Find route", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Route preview", exact: true }),
      ).toBeVisible();
      const result = await page.evaluate(() => (window as any).__exploreRoute);
      expect(result?.ok).toBe(true);
      const start = page.getByRole("button", {
        name: "Start navigation",
        exact: true,
      });
      if (result.canNavigate) await expect(start).toBeEnabled();
      else await expect(start).toBeDisabled();
    }
    await explore();
  }
  // A tap stages a pin rather than navigating or silently applying an endpoint.
  await entry();
  const map = page.getByRole("region", { name: /Interactive map/ });
  await map.click({ position: { x: 70, y: 70 } });
  await expect(
    page.getByRole("button", { name: "Plan from here", exact: true }),
  ).toBeVisible();
  await page.locator("button.back").click();
  await expect(
    page.getByRole("heading", { name: "Trails around you", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("checkbox", { name: /Show proposed trails/ }),
  ).toBeChecked();
  expect(await fitsWidth(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("[engine] Explore selection is accessible at large text and keeps empty endpoints unresolved", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 320 });
  await page.goto("/");
  await page.getByRole("button", { name: /Go somewhere/ }).waitFor();
  await page.evaluate(() => (document.documentElement.style.fontSize = "150%"));
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Show proposed trails/ }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Choose a ride point", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use map center", exact: true })
    .click();
  const from = page.getByRole("button", {
    name: "Plan from here",
    exact: true,
  });
  await expect(from).toBeVisible();
  for (const name of ["Plan from here", "Plan to here"]) {
    const button = page.getByRole("button", { name, exact: true });
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  expect(await fitsWidth(page)).toBe(true);
  await from.click();
  await expect(
    page.getByRole("button", { name: /^Destination:/ }),
  ).toContainText("Choose");
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: /Include proposed trails/ }),
  ).not.toBeChecked();
});

test("[engine] a real map-point response arriving after Cancel cannot replace a newer confirmed pin", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.Worker;
    let heldId: number | undefined;
    window.Worker = class extends Original {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.id === heldId) (window as any).__oldReceived = true;
          else if (data.result?.point && typeof data.result?.label === "string")
            (window as any).__newPoint = data.result;
        });
      }
      postMessage(message: any) {
        if (message.request?.op === "mapPoint" && heldId === undefined) {
          heldId = message.id;
          (window as any).__releaseOldPick = () => super.postMessage(message);
        } else super.postMessage(message);
      }
    } as typeof Worker;
  });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose a ride point", exact: true })
    .click();
  await page
    .getByRole("region", { name: /Interactive map/ })
    .press("ArrowLeft");
  await page
    .getByRole("button", { name: "Use map center", exact: true })
    .click();
  await expect(
    page.getByText("Checking map point…", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel map selection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose a ride point", exact: true })
    .click();
  await page
    .getByRole("region", { name: /Interactive map/ })
    .press("ArrowRight");
  await page
    .getByRole("button", { name: "Use map center", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Plan to here", exact: true }),
  ).toBeVisible();
  const newest = await page.evaluate(() => (window as any).__newPoint);
  await page.evaluate(() => (window as any).__releaseOldPick());
  await expect
    .poll(() => page.evaluate(() => (window as any).__oldReceived))
    .toBe(true);
  await page.getByRole("button", { name: "Plan to here", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Find route", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        (k) =>
          JSON.parse(localStorage.getItem(k) ?? "null")?.draft?.destination,
        key,
      ),
    )
    .toEqual({ ...newest.point, label: newest.label });
});
