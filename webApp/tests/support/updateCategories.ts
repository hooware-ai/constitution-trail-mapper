import { test, expect } from "@playwright/test";
for (const [mode, width, height, font] of [
  ["portrait", 390, 844, "100%"],
  ["landscape150", 640, 320, "150%"],
  ["narrow200", 320, 640, "200%"],
] as const) {
  test(`[engine] published update categories preserve exact notices, source status and keyboard jumps in ${mode}`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const Original = window.Worker;
      window.Worker = class extends Original {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          this.addEventListener("message", ({ data }) => {
            if (data.result?.updates)
              Object.assign(window, { publishedUpdates: data.result.updates });
          });
        }
      } as typeof Worker;
    });
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Go somewhere/ }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Updates", exact: true })
      .click();
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, font);
    await expect(
      page.getByText(/not a live report of conditions/),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            (window as unknown as { publishedUpdates?: unknown })
              .publishedUpdates,
          ),
        ),
      )
      .toBe(true);
    const updates = await page.evaluate(
      () =>
        (
          window as unknown as {
            publishedUpdates: {
              id: string;
              category: string;
              title: string;
              details: string;
              status: string;
              source?: { title: string; url: string };
              sourceUrl?: string;
            }[];
          }
        ).publishedUpdates,
    );
    expect(updates.length).toBeGreaterThan(0);
    expect(await page.locator(".updates-list article").count()).toBe(
      updates.length,
    );
    for (const update of updates) {
      const card = page.locator(`[data-update-id="${update.id}"]`);
      expect(await card.getAttribute("data-update-id")).toBe(update.id);
      expect(await card.locator(".update-status").textContent()).toBe(
        update.status,
      );
      expect(await card.getByRole("heading").textContent()).toBe(update.title);
      expect(await card.locator("p").last().textContent()).toBe(update.details);
      await expect(card.getByRole("link")).toHaveAttribute(
        "href",
        update.source?.url ?? update.sourceUrl!,
      );
      await expect(card.getByRole("link")).toHaveAttribute("target", "_blank");
      await expect(card.getByRole("link")).toHaveAttribute("rel", /noopener/);
      await expect(card.locator("..")).toHaveAttribute(
        "data-update-category",
        ["Conditions", "Routes", "Rules", "Maps"].includes(update.category)
          ? update.category
          : "Other published notices",
      );
    }
    const sections = page.locator(".update-category");
    expect(await sections.first().getAttribute("data-update-category")).toBe(
      "Conditions",
    );
    await expect(
      page.getByRole("heading", { name: "Reference resources", exact: true }),
    ).toBeAttached();
    const jumps = page.getByRole("group", { name: "Jump to notice category" });
    for (const category of ["Conditions", "Routes", "Rules", "Maps"]) {
      const button = jumps.getByRole("button", {
        name: new RegExp("^" + category + " "),
      });
      await button.scrollIntoViewIfNeeded();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await button.focus();
      await button.press("Enter");
      const heading = page
        .locator(`[data-update-category="${category}"]`)
        .getByRole("heading", { name: category, exact: true });
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      const bounds = await heading.boundingBox();
      const box = bounds!;
      expect(
        await heading.evaluate((element) => {
          const r = element.getBoundingClientRect();
          const x = Math.min(innerWidth - 1, Math.max(1, r.left + 4)),
            y = r.top + Math.min(4, r.height / 2);
          return (
            document.elementFromPoint(x, y) === element ||
            element.contains(document.elementFromPoint(x, y))
          );
        }),
      ).toBe(true);
      const navTop = await page
        .getByRole("navigation", { name: "Main navigation" })
        .evaluate((element) => element.getBoundingClientRect().top);
      expect(box.y + box.height).toBeLessThanOrEqual(navTop);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await context.setOffline(true);
    await expect(
      page.getByText(/Offline · No offline area downloaded/),
    ).toBeVisible();
    expect(await page.locator(".updates-list article").count()).toBe(
      updates.length,
    );
    await context.setOffline(false);
    await expect(
      page.getByText(/Online · No offline area downloaded/),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("category-jump.png"),
    });
    expect(errors).toEqual([]);
  });
}

test("[input-fault] unknown and missing published categories retain notices and a usable Other jump", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let done = false;
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.result?.updates && !done) {
            const first = data.result.updates.find(
              (u: { category: string }) => u.category === "Rules",
            );
            const second = data.result.updates.find(
              (u: { category: string }) => u.category === "Maps",
            );
            if (!first || !second) return;
            done = true;
            Object.assign(window, {
              uncategorizedNotices: JSON.parse(JSON.stringify([first, second])),
            });
            first.category = "Future category";
            delete second.category;
          }
        });
      }
    } as typeof Worker;
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Updates", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as { uncategorizedNotices?: unknown })
            .uncategorizedNotices,
        ),
      ),
    )
    .toBe(true);
  const records = await page.evaluate(
    () =>
      (
        window as unknown as {
          uncategorizedNotices: {
            id: string;
            title: string;
            details: string;
            status: string;
            source: { url: string };
          }[];
        }
      ).uncategorizedNotices,
  );
  const other = page.getByRole("region", {
    name: "Other published notices",
    exact: true,
  });
  await expect(other.locator("article")).toHaveCount(2);
  for (const record of records) {
    const card = other.locator(`[data-update-id="${record.id}"]`);
    expect(await card.getByRole("heading").textContent()).toBe(record.title);
    expect(await card.locator(".update-status").textContent()).toBe(
      record.status,
    );
    expect(await card.locator("p").last().textContent()).toBe(record.details);
    await expect(card.getByRole("link")).toHaveAttribute(
      "href",
      record.source.url,
    );
  }
  await page
    .getByRole("button", { name: "Other published notices (2)", exact: true })
    .click();
  await expect(
    other.getByRole("heading", {
      name: "Other published notices",
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    other.getByRole("heading", {
      name: "Other published notices",
      exact: true,
    }),
  ).toBeInViewport();
  expect(errors).toEqual([]);
});
