import { test, expect } from "@playwright/test";
test("[input-fault] feedback retry retains one receipt across Help sessions; no false success", async ({
  page,
}) => {
  const bodies: { id: string; kind: string; message: string }[] = [];
  let failed = true;
  await page.route("**/api/support", async (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (failed) {
      failed = false;
      await route.abort("failed");
    } else
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ saved: true, receipt: body.id }),
      });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Help and about", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Send feedback", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Feedback", exact: true })
    .fill("SYNTHETIC FIXTURE ONLY: retry message");
  await dialog
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(/could not confirm/);
  await expect(dialog.locator("code")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Back to help" }).click();
  await dialog
    .getByRole("button", { name: "Request a feature", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Feature request", exact: true }),
  ).toHaveValue("");
  await dialog.getByRole("button", { name: "Back to help" }).click();
  await dialog
    .getByRole("button", { name: "Send feedback", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Feedback", exact: true }),
  ).toHaveValue("SYNTHETIC FIXTURE ONLY: retry message");
  await dialog
    .getByRole("button", { name: "Retry submission", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(/Submitted privately/);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(await dialog.locator("code").innerText()).toBe(bodies[0].id);
});
test("[input-fault] feature requests show bounded failures and large-text controls stay usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 320 });
  await page.route("**/api/support", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "limit_reached" }),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page.evaluate(() => (document.documentElement.style.fontSize = "150%"));
  await page
    .getByRole("button", { name: "Help and about", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  for (const name of ["Send feedback", "Request a feature"]) {
    const button = dialog.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await dialog
    .getByRole("button", { name: "Request a feature", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Feature request", exact: true })
    .fill("SYNTHETIC FIXTURE ONLY: feature request throttle");
  await dialog
    .getByRole("button", { name: "Submit feature request", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(/Please try again later/);
  await expect(dialog.locator("code")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
