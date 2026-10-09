import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { refreshFixture, REFRESH_NOW } from "../support/refresh-fixture";
import { canonical } from "../../src/runtime/manifest";
import { identityOf } from "../../src/dataset";
import { simulateDevice, fix } from "../webkit/support";
const corePath = resolve(
  "../webBridge/build/dist/js/productionLibrary/TrailMapper-webBridge.mjs",
);
async function setup(context: BrowserContext, page: Page, restoreRide = false) {
  const { manifest, body } = await refreshFixture();
  const core = await import(pathToFileURL(corePath).href + "?app-runtime");
  const call = (r: unknown) => JSON.parse(core.dispatch(JSON.stringify(r)));
  const init = call({
    op: "initialize",
    trails: body,
    dataset: identityOf(manifest.dataset),
    trustSerializedRoutes: false,
    now: REFRESH_NOW,
  });
  const catalog = call({ op: "closureCatalog" });
  expect(catalog.schema).toBe("trail-mapper.compiled-closures/1");
  manifest.closures = catalog.closures.map((c: any) => ({
    id: c.id,
    contentSha256: createHash("sha256").update(canonical(c)).digest("hex"),
  }));
  const planned = call({
    op: "plan",
    start: { latitude: 40.5, longitude: -88.99 },
    destination: { latitude: 40.52, longitude: -88.97 },
    proposed: false,
    now: REFRESH_NOW,
  });
  expect(planned.canNavigate).toBe(true);
  const draft = {
    mode: "point",
    start: { latitude: 40.5, longitude: -88.99, label: "Synthetic start" },
    destination: {
      latitude: 40.52,
      longitude: -88.97,
      label: "Synthetic destination",
    },
    miles: 3,
    proposed: false,
  };
  const record = {
    key: planned.key,
    title: "Saved synthetic trail",
    route: planned.route,
    draft,
    createdAt: REFRESH_NOW - 1000,
    usedAt: REFRESH_NOW - 1000,
    dataset: identityOf(manifest.dataset),
  };
  let next = manifest,
    failed = false,
    corrupt = false,
    held = false;
  let release: (() => void) | null = null;
  await context.route("**/runtime-test/manifest", async (r) => {
    if (held) await new Promise<void>((resolve) => (release = resolve));
    if (failed) return r.abort("failed");
    return r.fulfill({
      contentType: "application/json",
      body: JSON.stringify(next),
    });
  });
  await context.route("**/data/dataset.json", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify(manifest.dataset),
    }),
  );
  await context.route("**/data/trails.*.json", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: corrupt ? "partial" : body,
    }),
  );
  await page.clock.install({ time: REFRESH_NOW });
  await simulateDevice(page);
  await page.addInitScript(
    ({ record, draft, now, restoreRide }) => {
      if (sessionStorage.getItem("runtime-seeded")) return;
      sessionStorage.setItem("runtime-seeded", "true");
      localStorage.setItem(
        "trail-mapper.county:trail-mapper.web.session.v1",
        JSON.stringify({
          version: 1,
          screen: "preview",
          selected: record,
          draft,
          savedTab: "saved",
          origin: "saved",
          updatedAt: now,
        }),
      );
      if (restoreRide)
        localStorage.setItem(
          "trail-mapper.county:trail-mapper.web.active-ride.v1",
          JSON.stringify({
            version: 1,
            record,
            routeProgressMeters: 0,
            riddenMeters: 0,
            creditedDistanceMeters: 0,
            updatedAt: now,
          }),
        );
    },
    { record, draft, now: REFRESH_NOW, restoreRide },
  );
  return {
    manifest,
    record,
    hold: () => (held = true),
    release: () => {
      held = false;
      release?.();
    },
    next: (value: typeof manifest) => (next = value),
    fail: (value: boolean) => (failed = value),
    corrupt: (value: boolean) => (corrupt = value),
  };
}
test.beforeEach(() => {
  test.skip(
    !existsSync(corePath),
    "Build Kotlin core for integrated App controls",
  );
});
test("integrated Start fails visibly on failed/partial refresh, retains saved route and recovers manually", async ({
  page,
  context,
}) => {
  const s = await setup(context, page);
  await page.goto("/tests/support/runtime-app-harness.html");
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check data again", exact: true }),
  ).toBeEnabled();
  s.fail(true);
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "retained" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toHaveCount(0);
  s.fail(false);
  s.next({
    ...s.manifest,
    sequence: 2,
    dataset: { ...s.manifest.dataset, version: "runtime-2" },
  });
  s.corrupt(true);
  await page
    .getByRole("button", { name: "Check data again", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /incomplete|damaged/ })
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            "trail-mapper.county:trail-mapper.web.session.v1",
          )!,
        ).selected.title,
    ),
  ).toBe(s.record.title);
  s.corrupt(false);
  await page
    .getByRole("button", { name: "Check data again", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check data again", exact: true }),
  ).toBeEnabled();
  await page.getByText("Data dates and review", { exact: true }).click();
  await expect(page.getByText(/runtime-2 ·/)).toBeVisible();
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toHaveCount(1);
  await fix(page, 40.5, -88.99);
  await expect(
    page.getByRole("button", { name: "Stop navigation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Connection needs a check", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Access connections to check", { exact: true }),
  ).toHaveCount(0);
});
test("integrated active guidance stays on accepted worker until Stop and explicit checked Start", async ({
  page,
  context,
}) => {
  const s = await setup(context, page);
  await page.goto("/tests/support/runtime-app-harness.html");
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toHaveCount(1);
  await fix(page, 40.5, -88.99);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).runtimeRoutingUses.some(
          (r: any) => r.op === "snapshot" && r.version === "runtime-1",
        ),
      ),
    )
    .toBe(true);
  s.next({
    ...s.manifest,
    sequence: 2,
    dataset: { ...s.manifest.dataset, version: "runtime-2" },
  });
  await page
    .getByRole("button", { name: "Check data again", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "stop safely" }),
  ).toBeVisible();
  await fix(page, 40.5, -88.9898);
  expect(
    await page.evaluate(() =>
      (window as any).runtimeRoutingUses.some(
        (r: any) => r.op === "snapshot" && r.version === "runtime-2",
      ),
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Stop navigation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toHaveCount(1);
  await fix(page, 40.5, -88.9898);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).runtimeRoutingUses.some(
          (r: any) => r.op === "snapshot" && r.version === "runtime-2",
        ),
      ),
    )
    .toBe(true);
});
test("reopened active ride never resumes on failed check; review/retry uses fresh worker and preserves foreground location gate", async ({
  page,
  context,
}) => {
  const s = await setup(context, page, true);
  s.fail(true);
  await page.goto("/tests/support/runtime-app-harness.html");
  await expect(
    page.getByRole("button", { name: "Check data again", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toHaveCount(0);
  s.fail(false);
  await page
    .getByRole("button", { name: "Check data again", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start navigation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      (window as any).runtimeRoutingUses.some((r: any) => r.op === "snapshot"),
    ),
  ).toBe(false);
  await fix(page, 40.5, -88.99);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).runtimeRoutingUses.some(
          (r: any) => r.op === "snapshot",
        ),
      ),
    )
    .toBe(true);
});

test("leaving preview during a held Start cannot launch navigation late", async ({
  page,
  context,
}) => {
  const s = await setup(context, page);
  await page.goto("/tests/support/runtime-app-harness.html");
  await expect(
    page.getByRole("button", { name: "Check data again", exact: true }),
  ).toBeEnabled();
  const inspectedBefore = await page.evaluate(
    () =>
      (window as any).runtimeRoutingUses.filter(
        (r: any) => r.op === "inspect:done",
      ).length,
  );
  s.hold();
  await page
    .getByRole("button", { name: "Start navigation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Checking data…", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Back$/ }).click();
  s.release();
  await expect(
    page.getByRole("button", { name: "Check data again", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        (before) =>
          (window as any).runtimeRoutingUses.filter(
            (r: any) => r.op === "inspect:done",
          ).length > before,
        inspectedBefore,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Ride in progress" }),
  ).toHaveCount(0);
});
