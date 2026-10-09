import test from "node:test";
import assert from "node:assert/strict";
import { RoutingClient } from "../../src/core";
import { DatasetError, identityOf, sha256Hex } from "../../src/dataset";
import { AccessLoader } from "../../src/accessTiles";
import { prepareRefreshRouting } from "../../src/runtime/prepareRouting";
import { canonical } from "../../src/runtime/manifest";
import { RuntimeFreshness } from "../../src/runtime/freshness";
import { REFRESH_NOW, refreshFixture } from "../support/refresh-fixture";
import type { Network } from "../../src/types";
const bytes = (text: string) =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;
async function fixture() {
  const { manifest } = await refreshFixture();
  const closure = {
    id: "known",
    title: "Closed trail",
    message: "Use posted detour",
    sourceUrl: "https://example.test/authority",
  };
  manifest.closures = [
    {
      id: closure.id,
      contentSha256: await sha256Hex(bytes(canonical(closure))),
    },
  ];
  const network: Network = {
    features: [],
    updates: [],
    freshnessMessage: "Synthetic",
    mode: "county",
    label: "Synthetic",
    dataset: identityOf(manifest.dataset),
    datasetRecord: manifest.dataset,
    closures: [{ ...closure }],
  };
  const calls: Record<string, unknown>[] = [];
  let disposed = 0,
    pinned: unknown;
  const client = {
    call: async (r: Record<string, unknown>) => {
      calls.push(r);
      return r.op === "closureCatalog"
        ? { schema: "trail-mapper.compiled-closures/1", closures: [closure] }
        : network;
    },
    pinDataset: (r: unknown) => (pinned = r),
    dispose: () => disposed++,
  } as unknown as RoutingClient;
  return {
    manifest,
    network,
    client,
    calls,
    get disposed() {
      return disposed;
    },
    get pinned() {
      return pinned;
    },
  };
}
test("candidate boots a separate pinned worker with upfront refresh validation and exact closure catalog", async () => {
  const s = await fixture();
  const data = await prepareRefreshRouting(
    s.manifest,
    new AbortController().signal,
    () => s.client,
  );
  assert.equal(data.value.client, s.client);
  assert.deepEqual(s.calls, [
    { op: "boot", pinned: s.manifest.dataset, validateRefresh: true },
    { op: "closureCatalog" },
  ]);
  assert.deepEqual(s.pinned, s.manifest.dataset);
  assert.equal(s.disposed, 0);
  data.dispose();
  assert.equal(s.disposed, 1);
});
test("mismatched identities/records and wrong builds dispose only candidate", async () => {
  for (const change of [
    (n: Network) => (n.mode = "fixture"),
    (n: Network) => (n.dataset = { ...n.dataset!, version: "other" }),
    (n: Network) =>
      (n.datasetRecord = { ...n.datasetRecord!, label: "changed" }),
  ]) {
    const s = await fixture();
    change(s.network);
    await assert.rejects(
      prepareRefreshRouting(
        s.manifest,
        new AbortController().signal,
        () => s.client,
      ),
      DatasetError,
    );
    assert.equal(s.disposed, 1);
  }
});
test("interrupted/pre-failed candidate cleanup never returns a prepared client", async () => {
  const s = await fixture();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    prepareRefreshRouting(s.manifest, abort.signal, () => s.client),
    /interrupted/,
  );
  assert.equal(s.disposed, 1);
  assert.equal(s.calls.length, 0);
  const f = await fixture();
  (f.client as any).call = async () => {
    throw Error("index missing");
  };
  await assert.rejects(
    prepareRefreshRouting(
      f.manifest,
      new AbortController().signal,
      () => f.client,
    ),
    /index missing/,
  );
  assert.equal(f.disposed, 1);
});
test("failed preparation retains the old accepted object", async () => {
  const s = await fixture();
  let raw = s.manifest;
  let fail = false;
  const runtime = new RuntimeFreshness({
    readManifest: async () => raw,
    prepare: async (m) => {
      if (fail) throw Error("partial mandatory download");
      return { manifest: m, value: 1, dispose: () => {} };
    },
    now: () => REFRESH_NOW,
  });
  await runtime.check("launch");
  const accepted = runtime.accepted;
  raw = { ...raw, sequence: 2 };
  fail = true;
  assert.equal(await runtime.check("manual"), false);
  assert.equal(runtime.accepted, accepted);
  assert.match(runtime.snapshot.error!, /partial/);
  runtime.dispose();
});
test("refresh preparation validates mandatory access index and retries a damaged/missing index without dispatch", async () => {
  const text = JSON.stringify({
    schema: "trail-mapper.access-index/1",
    cellDegrees: 0.01,
    windowCells: 1,
    radiusMeters: 600,
    base: { sha256: "a".repeat(64) },
    tiles: [],
  });
  const digest = await sha256Hex(bytes(text));
  let failure = true,
    fetches = 0;
  const loader = new AccessLoader(
    {
      base: {
        file: "base.aaaaaaaaaaaa.json",
        sha256: "a".repeat(64),
        bytes: 1,
        featureCount: 1,
      },
      index: {
        file: `index.${digest.slice(0, 12)}.json`,
        sha256: digest,
        bytes: bytes(text).byteLength,
        tileCount: 0,
        localFeatureCount: 0,
        tileAssignments: 0,
        tileBytes: 0,
      },
      cellDegrees: 0.01,
      windowCells: 1,
      radiusMeters: 600,
    },
    {
      fetchBytes: async () => {
        fetches++;
        return bytes(failure ? "partial" : text);
      },
      sha256Hex,
      dispatch: () => assert.fail("Index validation must not mutate router"),
    },
  );
  await assert.rejects(loader.validateIndex(), /integrity/);
  failure = false;
  await loader.validateIndex();
  await loader.validateIndex();
  assert.equal(fetches, 2);
});

test("Start adapter rechecks stale saved identity and closures even if a worker claims canNavigate", async () => {
  const { startReviewedRoute } = await import(
    "../../src/runtime/prepareRouting"
  );
  const { manifest } = await refreshFixture();
  let starts = 0;
  const requests: Record<string, unknown>[] = [];
  let response: any = {
    canNavigate: true,
    closures: [],
    network: { status: "stale" },
  };
  const client = {
    call: async (request: Record<string, unknown>) => {
      requests.push(request);
      return response;
    },
    dispose: () => {},
  } as unknown as RoutingClient;
  const runtime = new RuntimeFreshness({
    readManifest: async () => manifest,
    prepare: async (m) => ({
      manifest: m,
      value: { client, network: {} as Network },
      dispose: () => {},
    }),
    now: () => REFRESH_NOW,
  });
  const begin = () => {
    starts++;
  };
  assert.equal(
    await startReviewedRoute(runtime, { saved: true }, begin),
    false,
  );
  response = {
    canNavigate: true,
    closures: [{ id: "closure" }],
    network: { status: "current" },
  };
  assert.equal(
    await startReviewedRoute(runtime, { saved: true }, begin),
    false,
  );
  response = {
    canNavigate: true,
    closures: [],
    network: { status: "current" },
  };
  assert.equal(await startReviewedRoute(runtime, { saved: true }, begin), true);
  assert.equal(starts, 1);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[0].route, { saved: true });
});

test("complete compiled pins include rules absent from active display; missing, duplicate or changed catalog is refused", async () => {
  const s = await fixture();
  s.network.closures = [];
  const accepted = await prepareRefreshRouting(
    s.manifest,
    new AbortController().signal,
    () => s.client,
  );
  assert.equal(accepted.value.network.closures.length, 0);
  accepted.dispose();
  for (const catalog of [
    null,
    { schema: "future/2", closures: [] },
    { schema: "trail-mapper.compiled-closures/1", closures: [] },
    {
      schema: "trail-mapper.compiled-closures/1",
      closures: [{ id: "known" }, { id: "known" }],
    },
  ]) {
    const f = await fixture();
    const boot = f.client.call.bind(f.client);
    f.client.call = async (request) =>
      request.op === "closureCatalog" ? (catalog as any) : boot(request);
    await assert.rejects(
      prepareRefreshRouting(
        f.manifest,
        new AbortController().signal,
        () => f.client,
      ),
    );
    assert.equal(f.disposed, 1);
  }
  const old = await fixture();
  const boot = old.client.call.bind(old.client);
  old.client.call = async (request) => {
    if (request.op === "closureCatalog") throw Error("Unknown operation");
    return boot(request);
  };
  await assert.rejects(
    prepareRefreshRouting(
      old.manifest,
      new AbortController().signal,
      () => old.client,
    ),
    /complete compiled closure catalog/,
  );
});
