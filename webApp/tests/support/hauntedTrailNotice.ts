import { test, expect } from "@playwright/test";

for (const [width, height, font] of [
  [390, 844, "100%"],
  [640, 320, "150%"],
  [320, 640, "200%"],
] as const) {
  test(`informational Haunted Trail notice retains sources and expires by Chicago date at ${width}x${height} ${font}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-10-24T23:59:58-05:00") });
    await page.clock.pauseAt(new Date("2026-10-24T23:59:59-05:00"));
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Go somewhere/ }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Updates", exact: true })
      .click();
    await page.evaluate(
      (size) => (document.documentElement.style.fontSize = size),
      font,
    );
    const card = page.locator('[data-event-advisory="haunted-trail-2026"]');
    await expect(card).toContainText(
      "exact closure dates and portions unconfirmed",
    );
    await expect(card).toContainText("2–9 p.m. Chicago local time (CDT)");
    await expect(card).toContainText("October 15–17 and 23–24, 2026");
    await expect(card).toContainText(
      "This is not a continuous October 15–24 closure",
    );
    await expect(card).toContainText(
      "Follow posted signs; bikes are not allowed at the event",
    );
    await expect(card).toContainText(
      "Routes do not account for this informational notice",
    );
    const links = card.getByRole("link");
    expect(
      await links.evaluateAll((es) =>
        es.map((e) => (e as HTMLAnchorElement).href),
      ),
    ).toEqual([
      "https://www.normalil.gov/m/NewsFlash/Home/Detail/3363",
      "https://www.normalil.gov/349/Haunted-Trail",
      "https://www.normalil.gov/DocumentCenter/View/479/Haunted-Trail--Volunteers",
    ]);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener noreferrer/);
      await link.scrollIntoViewIfNeeded();
      await link.focus();
      await expect(link).toBeFocused();
      await expect(link).toBeInViewport();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.clock.runFor(2_000);
    await expect(card).toContainText(
      "Past event notice · reopening not confirmed",
    );
    await expect(card).toContainText(
      "These event dates have passed. That does not confirm reopening",
    );
    await expect(card).not.toContainText("Reported event notice");
    expect(errors).toEqual([]);
  });
}
