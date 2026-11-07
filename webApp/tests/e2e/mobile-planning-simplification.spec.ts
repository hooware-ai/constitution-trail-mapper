import { test, expect } from "@playwright/test";
import {
  openDisclosure,
  openHelp,
  openMainPage,
} from "../support/simplifiedNavigation";

for (const colorScheme of ["light", "dark"] as const) {
  test(`${colorScheme}: compact navigation retains secondary pages, Help, and browser Back`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("button")).toHaveText(["Plan", "Saved", "More"]);
    const more = nav.getByRole("button", { name: "More", exact: true });
    await more.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "More", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await more.click();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Plan a ride", exact: true }),
    ).toBeVisible();
    for (const name of ["Explore", "Updates"]) {
      await openMainPage(page, name);
      await expect(more).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await openHelp(page, true);
    await expect(
      page.getByRole("dialog", { name: "Help and about" }),
    ).toContainText("Your data and privacy");
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
  });
}

// Gate the real routing worker's boot request, not a fake network result.
for (const interaction of [
  "untouched",
  "dismissed More",
  "open More",
] as const) {
  test(`delayed trail boot preserves focus: ${interaction}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const Original = window.Worker;
      window.Worker = class extends Original {
        postMessage(message: any) {
          if (message?.request?.op === "boot") {
            (window as any).__releaseFocusBoot = () =>
              super.postMessage(message);
          } else super.postMessage(message);
        }
      };
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Loading trails…" }),
    ).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() => typeof (window as any).__releaseFocusBoot),
      )
      .toBe("function");
    const more = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "More", exact: true });
    const close = page.getByRole("button", { name: "Close More", exact: true });
    if (interaction !== "untouched") {
      await more.press("Enter");
      await expect(close).toBeFocused();
      if (interaction === "dismissed More") {
        await page.keyboard.press("Escape");
        await expect(more).toBeFocused();
      }
    }
    await page.evaluate(() => (window as any).__releaseFocusBoot());
    // tabindex is assigned by the focus frame: wait for the precise effect
    // that previously stole restored More focus, not an arbitrary timeout.
    const heading = page.locator(".panel h1");
    await expect(heading).toHaveText("Plan a ride");
    await expect(heading).toHaveAttribute("tabindex", "-1");
    if (interaction === "untouched") await expect(heading).toBeFocused();
    else if (interaction === "dismissed More") await expect(more).toBeFocused();
    else {
      await expect(close).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(more).toBeFocused();
    }
    // Real screen changes must still announce the new panel.
    await page.getByRole("button", { name: /Go somewhere/ }).click();
    await expect(page.locator(".panel h1")).toBeFocused();
  });
}

test("reference disclosures preserve map semantics and keyboard access to search privacy", async ({
  page,
}) => {
  await page.goto("/");
  const key = page.locator("details.home-map-key");
  await expect(key).not.toHaveAttribute("open", "");
  await key.locator("summary").press("Enter");
  await expect(key.locator(".legend")).toBeVisible();
  await page.getByRole("button", { name: /Go somewhere/ }).click();
  const proposed = page.getByRole("checkbox", {
    name: /Include proposed trails/,
    includeHidden: true,
  });
  await expect(proposed).not.toBeChecked();
  await expect(proposed).not.toBeVisible();
  await openDisclosure(page, "details.route-options");
  await expect(
    page.getByText("Opt in to planned paths that may not be built or usable."),
  ).toBeVisible();
  await proposed.check();
  await expect(page.locator("details.route-options summary")).toContainText(
    "proposed trails on",
  );
  await page.getByRole("button", { name: /^Start:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Choose start" });
  const summary = dialog.locator("details.search-explanation > summary");
  await dialog.getByRole("button", { name: "Close Choose start" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText(/Typed text is never saved/)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close Choose start" }),
  ).toBeFocused();
});

test("custom distance stays open while typing preset prefixes and retains validation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Make an exercise loop/ }).click();
  const distance = page.getByRole("spinbutton", { name: "Custom miles" });
  await expect(distance).not.toBeVisible();
  await openDisclosure(page, "details.custom-distance");
  for (const value of ["50", "30", "80", "100"]) {
    await distance.fill("");
    await distance.pressSequentially(value);
    await expect(distance).toHaveValue(value);
    await expect(distance).toBeFocused();
    await expect(distance).toBeVisible();
  }
  await distance.fill("101");
  await expect(distance).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("button", { name: "Make loop", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Choose 0.5–100 miles. The route may vary from your target.",
    ),
  ).toBeVisible();
});
