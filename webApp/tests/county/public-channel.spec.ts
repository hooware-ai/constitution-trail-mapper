import { test, expect } from "@playwright/test";

// The public-channel build of the (unapproved, synthetic) package: it must refuse to show the data at all.
const port = Number(process.env.TRAIL_TEST_PORT ?? 4175) + 1;
test.use({ baseURL: `http://127.0.0.1:${port}` });

test("a public build refuses data that is not approved, shows why, and offers no fixture or partial map", async ({
  page,
}) => {
  await page.goto("/");
  const alert = page.getByRole("alert").filter({ hasText: "could not load" });
  await expect(alert).toContainText("has not been approved for public use");
  await expect(page.getByText("Review trailhead")).toHaveCount(0);
  await expect(page.locator(".review-banner")).not.toContainText("Synthetic");
  await expect(page.getByRole("button", { name: /Go somewhere/ })).toHaveCount(
    0,
  );
  await alert.getByRole("button", { name: "Retry loading" }).click();
  await expect(alert).toContainText("has not been approved for public use");
});
