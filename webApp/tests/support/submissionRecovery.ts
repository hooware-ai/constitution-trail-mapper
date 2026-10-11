import { test, expect } from "@playwright/test";
test("[input-fault] permanent rejection unlocks editing and uses a new receipt; invalid controls never send", async ({
  page,
}) => {
  const bodies: { id: string; message: string }[] = [];
  await page.route("**/api/support", (route) => {
    const value = route.request().postDataJSON();
    bodies.push(value);
    return route.fulfill({
      status: bodies.length === 1 ? 400 : 201,
      contentType: "application/json",
      body: JSON.stringify(
        bodies.length === 1
          ? { error: "invalid_input" }
          : { saved: true, receipt: value.id },
      ),
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
  const field = dialog.getByRole("textbox", { name: "Feedback", exact: true });
  await field.fill("SYNTHETIC TEST ONLY: invalid\u000bcontrol");
  await dialog
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(/remove unsupported/);
  expect(bodies).toHaveLength(0);
  await field.fill("SYNTHETIC TEST ONLY: initial rejected message");
  await dialog
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(/Please edit/);
  await expect(field).not.toHaveAttribute("readonly", "");
  await field.fill("SYNTHETIC TEST ONLY: revised accepted message");
  await dialog
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(/Submitted privately/);
  expect(bodies).toHaveLength(2);
  expect(bodies[0].id).not.toBe(bodies[1].id);
});
