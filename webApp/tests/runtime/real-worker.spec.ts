import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { refreshFixture, REFRESH_NOW } from "../support/refresh-fixture";
import { canonical } from "../../src/runtime/manifest";
import { identityOf } from "../../src/dataset";
import type { RouteResult } from "../../src/types";
const corePath = resolve(
  "../webBridge/build/dist/js/productionLibrary/TrailMapper-webBridge.mjs",
);
test("real isolated workers retain active routing on partial/closure-mismatch failure and stage validated replacement", async ({
  page,
  context,
}) => {
  test.skip(
    !existsSync(corePath),
    "Build the Kotlin core for real worker validation",
  );
  const { manifest, body } = await refreshFixture();
  const core = await import(pathToFileURL(corePath).href + "?runtime-pins");
  const initialized = JSON.parse(
    core.dispatch(
      JSON.stringify({
        op: "initialize",
        trails: body,
        dataset: identityOf(manifest.dataset),
        trustSerializedRoutes: false,
        now: REFRESH_NOW,
      }),
    ),
  );
  expect(initialized.ok).toBe(true);
  manifest.closures = initialized.closures.map((c: any) => ({
    id: c.id,
    contentSha256: createHash("sha256").update(canonical(c)).digest("hex"),
  }));
  let next = manifest,
    corrupt = false;
  await context.route("**/runtime-test/manifest", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(next),
    }),
  );
  await context.route("**/data/trails.*.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: corrupt ? "partial" : body,
    }),
  );
  await page.clock.install({ time: REFRESH_NOW });
  await page.goto("/tests/support/runtime-real-harness.html");
  const api = async (expression: string) =>
    page.evaluate(`window.realRuntime.${expression}`);
  await expect.poll(() => api("version()")).toBe("runtime-1");
  const planned = (await api("plan()")) as RouteResult;
  expect(planned.canNavigate).toBe(true);
  await page.evaluate(
    (route) => (window as any).realRuntime.start(route),
    planned.route,
  );
  expect(await api("starts()")).toBe(1);
  next = {
    ...manifest,
    sequence: 2,
    dataset: { ...manifest.dataset, version: "runtime-2" },
  };
  corrupt = true;
  expect(await api("check()")).toBe(false);
  expect(await api("version()")).toBe("runtime-1");
  const inspect = await page.evaluate(
    (route) => (window as any).realRuntime.inspect(route),
    planned.route,
  );
  expect(inspect.canNavigate).toBe(true);
  corrupt = false;
  next = {
    ...next,
    closures: [
      ...next.closures,
      { id: "invented-catalog-entry", contentSha256: "b".repeat(64) },
    ],
  };
  expect(await api("check()")).toBe(false);
  expect(await api("version()")).toBe("runtime-1");
  next = { ...next, closures: manifest.closures };
  expect(await api("check()")).toBe(true);
  expect(await api("state().pendingSequence")).toBe(2);
  expect(await api("version()")).toBe("runtime-1");
  await api("active(false)");
  expect(await api("version()")).toBe("runtime-1");
  expect(await api("check()")).toBe(true);
  expect(await api("version()")).toBe("runtime-2");
  const result = await page.evaluate(
    (route) => (window as any).realRuntime.start(route),
    planned.route,
  );
  expect(result).toBe(true);
  expect(await api("starts()")).toBe(2);
});
