import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { refreshFixture, REFRESH_NOW } from "../support/refresh-fixture";
import type { RefreshManifest } from "../../src/runtime/manifest";
const api = async <T>(page: Page, expression: string): Promise<T> =>
  page.evaluate(`window.runtimeTest.${expression}`);
async function serve(context: BrowserContext) {
  const fixture = await refreshFixture();
  let manifest: RefreshManifest = fixture.manifest,
    failed = false,
    corrupt = false,
    held = false;
  let release: (() => void) | null = null;
  let requests = 0;
  const cache: string[] = [];
  await context.route("**/runtime-test/**", async (route) => {
    if (route.request().url().endsWith("/manifest")) {
      requests++;
      cache.push(route.request().headers()["cache-control"] ?? "");
      if (held) await new Promise<void>((resolve) => (release = resolve));
      if (failed) return route.abort("failed");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(manifest),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: corrupt ? "truncated" : fixture.body,
    });
  });
  return {
    fixture,
    next: (m: RefreshManifest) => (manifest = m),
    fail: (x: boolean) => (failed = x),
    corrupt: (x: boolean) => (corrupt = x),
    hold: () => (held = true),
    release: () => {
      held = false;
      release?.();
    },
    requests: () => requests,
    cache,
  };
}
async function open(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch;
    const seen: string[] = [];
    Object.assign(window, { manifestFetchCache: seen });
    window.fetch = (url, init) => {
      if (String(url).includes("/runtime-test/manifest"))
        seen.push(init?.cache ?? "default");
      return original(url, init);
    };
  });
  await page.clock.install({ time: REFRESH_NOW });
  await page.goto("/tests/support/runtime-harness.html");
  await expect.poll(() => api(page, "state().acceptedSequence")).toBe(1);
  await expect.poll(() => api(page, "state().checking")).toBe(false);
}
test("status catches a runtime change between render and subscription", async ({
  page,
}) => {
  await page.goto("/tests/support/runtime-harness.html?subscription-gap=1");
  await expect.poll(() => api(page, "state().offline")).toBe(true);
  await expect(page.getByRole("status")).toContainText("Offline");
  expect(await api(page, "accepted()")).toBeNull();
  expect(await api(page, "counts().starts")).toBe(0);
});
test("accessible failure/manual recovery keeps accepted version, timestamps and legal warnings", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  await open(page);
  await expect(page.getByText("test-build-separate-from-data")).toBeVisible();
  await expect(page.getByText("Unknown", { exact: true })).toBeVisible();
  s.fail(true);
  await page.getByRole("button", { name: "Check data again" }).click();
  await expect(page.getByRole("alert")).toContainText("retained");
  expect(await api(page, "accepted().sequence")).toBe(1);
  await expect(
    page.getByText("Existing legal attribution and closure warning stay here."),
  ).toBeVisible();
  s.fail(false);
  await page.getByRole("button", { name: "Check data again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(() =>
      (window as any).manifestFetchCache.every((x: string) => x === "no-store"),
    ),
  ).toBe(true);
});
test("partial content, incompatible and unapproved releases retain accepted data and never Start", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  await open(page);
  const next = {
    ...s.fixture.manifest,
    sequence: 2,
    dataset: { ...s.fixture.manifest.dataset, version: "2" },
  };
  s.next(next);
  s.corrupt(true);
  expect(await api(page, "check()")).toBe(false);
  expect(await api(page, "accepted().sequence")).toBe(1);
  expect(await api(page, "start()")).toBe(false);
  s.corrupt(false);
  s.next({ ...next, schema: "future/99" } as unknown as RefreshManifest);
  expect(await api(page, "check()")).toBe(false);
  s.next({
    ...next,
    dataset: {
      ...next.dataset,
      approval: { ...next.dataset.approval, approved: false },
    },
  });
  expect(await api(page, "check()")).toBe(false);
  s.next(next);
  expect(await api(page, "start()")).toBe(true);
  expect(await api(page, "accepted().sequence")).toBe(2);
});
test("active ride stages reviewed update, failed subsequent check preserves ride and closures", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  await open(page);
  expect(await api(page, "start()")).toBe(true);
  s.next({
    ...s.fixture.manifest,
    sequence: 2,
    dataset: { ...s.fixture.manifest.dataset, version: "2" },
    closures: [
      ...s.fixture.manifest.closures,
      { id: "new-closure", contentSha256: "b".repeat(64) },
    ],
  });
  await api(page, "check()");
  expect(await api(page, "accepted().sequence")).toBe(1);
  await expect(page.getByRole("status")).toContainText("stop safely");
  s.fail(true);
  await api(page, "check()");
  expect(await api(page, "state().activeRide")).toBe(true);
  expect(await api(page, "accepted().closures.length")).toBe(1);
  await api(page, "active(false)");
  expect(await api(page, "start()")).toBe(false);
  s.fail(false);
  expect(await api(page, "start()")).toBe(true);
  expect(await api(page, "accepted().sequence")).toBe(2);
});
test("offline recovery, source staleness and cache quota errors remain actionable", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  await open(page);
  await context.setOffline(true);
  expect(await api(page, "start()")).toBe(false);
  expect(await api(page, "accepted().sequence")).toBe(1);
  await context.setOffline(false);
  await api(page, "quota()");
  s.next({
    ...s.fixture.manifest,
    sequence: 2,
    dataset: { ...s.fixture.manifest.dataset, version: "2" },
  });
  await api(page, "check()");
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await page.clock.fastForward(86400000);
  expect(await api(page, "start()")).toBe(false);
  await expect(page.getByRole("alert").first()).toContainText("stale");
});
test("real concurrent tab storage events recheck; stale rollback and absent closure cannot authorize Start", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  await open(page);
  const other = await context.newPage();
  await open(other);
  const before = s.requests();
  s.next({
    ...s.fixture.manifest,
    sequence: 2,
    dataset: { ...s.fixture.manifest.dataset, version: "2" },
  });
  await api(page, "check()");
  await expect.poll(() => api(other, "state().acceptedSequence")).toBe(2);
  expect(s.requests()).toBeGreaterThan(before + 1);
  s.next(s.fixture.manifest);
  expect(await api(other, "start()")).toBe(false);
  expect(await api(other, "accepted().sequence")).toBe(2);
  s.next({ ...s.fixture.manifest, sequence: 3, closures: [] });
  expect(await api(other, "check()")).toBe(false);
  expect(await api(other, "accepted().closures.length")).toBe(1);
});
test("repeated interrupted checks and disposal do not resurrect data; reopened tabs check before Start", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  await open(page);
  s.hold();
  const before = s.requests();
  const attempt = api(page, "check()");
  await expect.poll(() => s.requests()).toBe(before + 1);
  await page.evaluate(() => {
    void (window as any).runtimeTest.check();
    void (window as any).runtimeTest.check();
  });
  expect(s.requests()).toBe(before + 1);
  await api(page, "dispose()");
  s.release();
  await attempt;
  expect(await api(page, "accepted()")).toBe(null);
  const other = await context.newPage();
  s.fail(true);
  await other.clock.install({ time: REFRESH_NOW });
  await other.goto("/tests/support/runtime-harness.html");
  await expect.poll(() => api(other, "state().error")).not.toBe(null);
  expect(await api(other, "start()")).toBe(false);
  expect(await api(other, "accepted()")).toBe(null);
  s.fail(false);
  expect(await api(other, "start()")).toBe(true);
  expect(await api(other, "counts().inspected")).toBe(1);
});
test("reload and new tab retain rejection floor; failed storage blocks Start and recovers", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  await open(page);
  s.next({ ...s.fixture.manifest, sequence: 2 });
  expect(await api(page, "check()")).toBe(true);
  s.next(s.fixture.manifest);
  await page.reload();
  await expect
    .poll(() => api(page, "state().checking"), { timeout: 20000 })
    .toBe(false);
  await expect(page.getByRole("alert")).toContainText("older release");
  expect(await api(page, "accepted()")).toBeNull();
  const other = await context.newPage();
  await other.clock.install({ time: REFRESH_NOW });
  await other.goto("/tests/support/runtime-harness.html");
  await expect(other.getByRole("alert")).toContainText("older release");
  s.next({ ...s.fixture.manifest, sequence: 3, closures: [] });
  expect(await api(page, "check()")).toBe(false);
  await expect(page.getByRole("alert")).toContainText("closure");
  s.next({ ...s.fixture.manifest, sequence: 3 });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.assign(window, {
      restoreStorage: () => (Storage.prototype.setItem = original),
    });
    Storage.prototype.setItem = function (key, value) {
      if (key.includes("safety-floor")) throw Error("quota");
      return original.call(this, key, value);
    };
  });
  expect(await api(page, "start()")).toBe(false);
  expect(await api(page, "accepted()")).toBeNull();
  await expect(page.getByRole("alert")).toContainText("could not be saved");
  await page.evaluate(() => (window as any).restoreStorage());
  expect(await api(page, "start()")).toBe(true);
  expect(await api(page, "accepted().sequence")).toBe(3);
});
test("long horizon freshness timer rearms beyond browser timeout limit", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  s.next({
    ...s.fixture.manifest,
    sources: s.fixture.manifest.sources.map((source) => ({
      ...source,
      staleAfterMs: 60 * 86400000,
    })),
  });
  await open(page);
  expect(await api(page, "check()")).toBe(true);
  await expect(page.getByRole("status")).toContainText("Reviewed data checked");
  await page.clock.fastForward(23 * 86400000);
  await page.clock.fastForward(2 * 86400000);
  await expect(page.getByRole("status")).toContainText("Reviewed data checked");
  await page.clock.fastForward(20 * 86400000);
  await page.clock.fastForward(16 * 86400000);
  await expect(page.getByRole("status")).toContainText(
    "Source evidence is stale",
  );
});
test("clock rollback and reload preserve floor; correcting time still rejects unsafe releases", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  await open(page);
  const next = { ...s.fixture.manifest, sequence: 2 };
  s.next(next);
  expect(await api(page, "check()")).toBe(true);
  const floor = await page.evaluate(() =>
    localStorage.getItem("trail-mapper.refresh-safety-floor/1"),
  );
  await api(page, "active(true)");
  await page.clock.setSystemTime(REFRESH_NOW - 86400000);
  expect(await api(page, "check()")).toBe(false);
  await expect(page.getByRole("alert")).toContainText("device's clock");
  expect(await api(page, "accepted().sequence")).toBe(2);
  expect(await api(page, "state().activeRide")).toBe(true);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("trail-mapper.refresh-safety-floor/1"),
    ),
  ).toBe(floor);
  await page.reload();
  await expect
    .poll(() => api(page, "state().checking"), { timeout: 20000 })
    .toBe(false);
  await expect(page.getByRole("alert")).toContainText("device's clock");
  expect(await api(page, "accepted()")).toBeNull();
  expect(await api(page, "start()")).toBe(false);
  await page.clock.setSystemTime(REFRESH_NOW);
  s.next(s.fixture.manifest);
  expect(await api(page, "check()")).toBe(false);
  await expect(page.getByRole("alert")).toContainText("older release");
  s.next({ ...next, sequence: 3, closures: [] });
  expect(await api(page, "check()")).toBe(false);
  await expect(page.getByRole("alert")).toContainText("Known closure");
  s.next(next);
  expect(await api(page, "start()")).toBe(true);
  expect(await api(page, "accepted().sequence")).toBe(2);
});
test("damaged or unavailable history fails closed and intact restoration needs fresh validated bytes", async ({
  page,
  context,
}) => {
  const s = await serve(context);
  await open(page);
  s.next({ ...s.fixture.manifest, sequence: 2 });
  expect(await api(page, "check()")).toBe(true);
  const floor = await page.evaluate(() =>
    localStorage.getItem("trail-mapper.refresh-safety-floor/1"),
  );
  await page.evaluate(() =>
    localStorage.setItem("trail-mapper.refresh-safety-floor/1", "{interrupted"),
  );
  expect(await api(page, "start()")).toBe(false);
  await expect(page.getByRole("alert")).toContainText("history is damaged");
  expect(await api(page, "accepted().sequence")).toBe(2);
  await page.reload();
  await expect
    .poll(() => api(page, "state().checking"), { timeout: 20000 })
    .toBe(false);
  await expect(page.getByRole("alert")).toContainText("history is damaged");
  expect(await api(page, "accepted()")).toBeNull();
  await page.evaluate(() => {
    const get = Storage.prototype.getItem;
    Object.assign(window, {
      restoreRead: () => (Storage.prototype.getItem = get),
    });
    Storage.prototype.getItem = function (key) {
      if (key.includes("safety-floor"))
        throw new DOMException("Blocked", "SecurityError");
      return get.call(this, key);
    };
  });
  expect(await api(page, "check()")).toBe(false);
  await expect(page.getByRole("alert")).toContainText(
    "storage access is unavailable",
  );
  await page.evaluate(() => (window as any).restoreRead());
  await page.evaluate(
    (saved) =>
      localStorage.setItem("trail-mapper.refresh-safety-floor/1", saved!),
    floor,
  );
  s.next(s.fixture.manifest);
  expect(await api(page, "check()")).toBe(false);
  await expect(page.getByRole("alert")).toContainText("older release");
  s.next({ ...s.fixture.manifest, sequence: 2 });
  s.corrupt(true);
  expect(await api(page, "start()")).toBe(false);
  expect(await api(page, "accepted()")).toBeNull();
  s.corrupt(false);
  expect(await api(page, "start()")).toBe(true);
  expect(await api(page, "accepted().sequence")).toBe(2);
});
