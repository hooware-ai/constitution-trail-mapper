import { test, expect } from "@playwright/test";

for (const [mode, width, height, fontSize] of [
  ["portrait", 390, 844, "100%"],
  ["short landscape", 640, 320, "100%"],
  ["short landscape at 150% text", 640, 320, "150%"],
] as const) {
  test(`[engine] Explore layers retain a usable map and all controls in ${mode}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Explore", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Trails around you" }),
    ).toBeVisible();
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, fontSize);
    const summary = page.getByText("Layers and map key", { exact: true });
    const map = page.getByRole("region", { name: /Interactive map/ });
    const visibleMap = async () =>
      map.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return Math.max(
          0,
          Math.min(r.bottom, innerHeight) - Math.max(0, r.top),
        );
      });
    const checkMap = async () => {
      expect(await visibleMap()).toBeGreaterThanOrEqual(100);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    };
    await expect(page.locator(".explore-layers")).not.toHaveAttribute(
      "open",
      "",
    );
    await summary.focus();
    await summary.press("Enter");
    const summaryBox = await summary.boundingBox();
    expect(summaryBox!.height).toBeGreaterThanOrEqual(44);
    const closures = page.getByRole("checkbox", {
      name: /Reported closure areas/,
    });
    const proposed = page.getByRole("checkbox", {
      name: /Show proposed trails/,
    });
    await expect(closures).toBeChecked();
    await expect(proposed).not.toBeChecked();
    await closures.scrollIntoViewIfNeeded();
    await checkMap();
    await expect(page.getByText(/approximate work corridors/)).toBeVisible();
    await closures.uncheck();
    await expect(closures).not.toBeChecked();
    await checkMap();
    await proposed.check();
    await expect(proposed).toBeChecked();
    await checkMap();
    for (const label of [
      "Trail",
      "Park connector",
      "Street access",
      "Shared roadway",
      "Proposed · not built",
      "Trail closed",
    ]) {
      const key = page
        .locator(".explore-layers .legend")
        .getByText(label, { exact: true });
      await key.scrollIntoViewIfNeeded();
      await expect(key).toBeVisible();
      await checkMap();
    }
    await summary.focus();
    await summary.press("Space");
    await expect(summary).toBeFocused();
    await summary.press("Enter");
    await expect(closures).not.toBeChecked();
    await expect(proposed).toBeChecked();
    await page
      .getByRole("button", { name: "Help, privacy and sources", exact: true })
      .scrollIntoViewIfNeeded();
    await checkMap();
    await page
      .getByRole("link", { name: /^County map/ })
      .scrollIntoViewIfNeeded();
    await checkMap();
    await page
      .getByRole("button", { name: "Show all trails", exact: true })
      .click();
    await checkMap();
    await map.focus();
    await map.press("ArrowRight");
    await expect(map).toBeFocused();
    await page
      .getByRole("button", { name: "Choose a ride point", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Cancel map selection", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Trails around you" }),
    ).toBeFocused();
    await summary.click();
    await expect(closures).not.toBeChecked();
    await expect(proposed).toBeChecked();
    await checkMap();
    expect(errors).toEqual([]);
  });
}
