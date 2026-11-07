import { expect, type Page } from "@playwright/test";

/** Follow the visible navigation, including its secondary-page disclosure. */
export async function openMainPage(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  if (name === "Explore" || name === "Updates") {
    await nav.getByRole("button", { name: "More", exact: true }).click();
    await page
      .getByRole("dialog", { name: "More", exact: true })
      .getByRole("button", {
        name: name === "Explore" ? /^Explore map/ : /^Trail updates/,
      })
      .click();
  } else {
    await nav.getByRole("button", { name, exact: true }).click();
  }
}

export async function openHelp(page: Page, keyboard = false) {
  const activate = async (button: ReturnType<Page["getByRole"]>) =>
    keyboard ? button.press("Enter") : button.click();
  const more = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "More", exact: true });
  if (await more.isVisible()) {
    await activate(more);
    await activate(
      page
        .getByRole("dialog", { name: "More", exact: true })
        .getByRole("button", { name: /^Help and about/ }),
    );
  } else {
    await activate(page.getByRole("button", { name: /^Help/ }).first());
  }
  await expect(
    page.getByRole("dialog", { name: "Help and about", exact: true }),
  ).toBeVisible();
}

export async function openDisclosure(page: Page, selector: string) {
  const details = page.locator(selector);
  await expect(details).toBeAttached();
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open)))
    await details.locator(":scope > summary").click();
}
