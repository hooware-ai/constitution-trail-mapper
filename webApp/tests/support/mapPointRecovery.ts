import { test, expect } from "@playwright/test";

for (const [width, height] of [
  [360, 640],
  [390, 844],
]) {
  test(`canvas point selection is unobstructed on ${width}×${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.getByRole("button", { name: /Go somewhere/ }).click();
    await page.getByRole("button", { name: /^Start:/ }).click();
    await page
      .getByRole("button", { name: "Pick on map", exact: true })
      .click();
    const map = page.locator(".map");
    await map.scrollIntoViewIfNeeded();
    const bounds = await map.boundingBox();
    const picker = await page.locator(".map-wrap > .map-picker").boundingBox();
    expect(picker!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height - 1);
    await map.click({
      position: { x: bounds!.width / 2, y: bounds!.height / 2 },
    });
    await expect(
      page.getByRole("heading", { name: "Go somewhere", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Start:/ }),
    ).not.toContainText("Choose a place");
    await page.getByRole("button", { name: /^Destination:/ }).click();
    await page
      .getByRole("button", { name: "Pick on map", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Use map center", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Go somewhere", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Destination:/ }),
    ).not.toContainText("Choose a place");
  });
}
