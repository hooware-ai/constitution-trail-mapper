import test from "node:test";
import assert from "node:assert/strict";
import {
  RuntimeFreshness,
  type PreparedData,
} from "../../src/runtime/freshness";
import {
  assertSafeSuccessor,
  canonical,
  parseRefreshManifest,
  staleSources,
  type RefreshManifest,
} from "../../src/runtime/manifest";
import {
  fetchRefreshManifest,
  saveRefreshHint,
} from "../../src/runtime/browser";
import { REFRESH_NOW, refreshFixture } from "../support/refresh-fixture";
async function setup() {
  const { manifest } = await refreshFixture();
  let next: unknown = manifest,
    failure: Error | null = null,
    prepares = 0,
    cacheFailure = false,
    now = REFRESH_NOW;
  const disposed: number[] = [];
  const runtime = new RuntimeFreshness<number>({
    readManifest: async () => {
      if (failure) throw failure;
      return next;
    },
    prepare: async (m) => {
      prepares++;
      return {
        manifest: m,
        value: m.sequence,
        dispose: () => {
          disposed.push(m.sequence);
        },
      };
    },
    now: () => now,
    saveManifest: () => {
      if (cacheFailure) throw Error("quota");
    },
  });
  return {
    runtime,
    manifest,
    disposed,
    get prepares() {
      return prepares;
    },
    setNext: (m: unknown) => (next = m),
    fail: (e: Error | null) => (failure = e),
    cacheFail: () => (cacheFailure = true),
    advance: (ms: number) => (now += ms),
  };
}
test("unknown schemas, incomplete metadata, approval blockers, duplicate sources and future dates fail closed", async () => {
  const { manifest: m } = await refreshFixture();
  const invalid = [
    null,
    { ...m, schema: "future/2" },
    { ...m, sources: [] },
    { ...m, closures: undefined },
    { ...m, sources: [...m.sources, ...m.sources] },
    { ...m, sequence: 0 },
    { ...m, releasedAtUtc: "2099-01-01T00:00:00Z" },
    {
      ...m,
      dataset: {
        ...m.dataset,
        approval: { ...m.dataset.approval, approved: false },
      },
    },
    {
      ...m,
      dataset: {
        ...m.dataset,
        approval: { ...m.dataset.approval, blockers: ["unresolved"] },
      },
    },
  ];
  for (const value of invalid)
    assert.throws(() => parseRefreshManifest(value, REFRESH_NOW));
  const parsed = parseRefreshManifest(m, REFRESH_NOW);
  parsed.sources[0].id = "mutated";
  assert.equal(m.sources[0].id, "synthetic-source");
});
test("closure removal/change, source disappearance, rollback and sequence equivocation need explicit admission", async () => {
  const { manifest: m } = await refreshFixture();
  for (const n of [
    { ...m, sequence: 2, closures: [] },
    {
      ...m,
      sequence: 2,
      closures: [{ id: m.closures[0].id, contentSha256: "b".repeat(64) }],
    },
    { ...m, sequence: 2, sources: [] },
    { ...m, sequence: 0 },
    { ...m, releasedAtUtc: "2026-10-09T11:30:00Z" },
  ])
    assert.throws(() => assertSafeSuccessor(m, n));
  const n = {
    ...m,
    sequence: 2,
    closures: [],
    releasedAtUtc: "2026-10-09T12:00:00Z",
    reopenings: [
      {
        id: m.closures[0].id,
        fromSequence: m.sequence,
        toSequence: 2,
        fromContentSha256: m.closures[0].contentSha256,
        toContentSha256: null,
        evidenceUrl: "https://example.test/authority",
        reviewedBy: "Reviewer",
        reviewedAtUtc: "2026-10-09T11:45:00Z",
      },
    ],
  };
  assert.doesNotThrow(() =>
    assertSafeSuccessor(m, parseRefreshManifest(n, REFRESH_NOW)),
  );
  assert.throws(() =>
    assertSafeSuccessor(m, {
      ...n,
      reopenings: [
        { ...n.reopenings[0], reviewedAtUtc: "2026-10-08T11:00:00Z" },
      ],
    }),
  );
});
test("staleness uses source check AND review; unknown publication stays unknown", async () => {
  const { manifest: m } = await refreshFixture();
  assert.deepEqual(staleSources(m, REFRESH_NOW), []);
  assert.deepEqual(
    staleSources(m, Date.parse(m.sources[0].checkedAtUtc) + 86400000),
    ["synthetic-source"],
  );
  assert.deepEqual(
    staleSources(
      {
        ...m,
        sources: [{ ...m.sources[0], reviewedAtUtc: "2026-10-01T11:00:00Z" }],
      },
      REFRESH_NOW,
    ),
    ["synthetic-source"],
  );
  assert.equal(m.sources[0].publishedAtUtc, null);
});
test("repeated check triggers share preparation; same release is idempotent", async () => {
  const s = await setup();
  const first = s.runtime.check("launch");
  assert.equal(first, s.runtime.check("manual"));
  assert.equal(await first, true);
  assert.equal(s.prepares, 1);
  assert.equal(await s.runtime.check("resume"), true);
  assert.equal(s.prepares, 1);
  assert.equal(s.runtime.snapshot.successfulCheckAt, REFRESH_NOW);
  s.runtime.dispose();
});
test("failed and partial checks retain accepted data/closures; repeated failure is recorded; recovery clears failure", async () => {
  const s = await setup();
  await s.runtime.check("launch");
  const accepted = s.runtime.accepted;
  s.fail(Error("interrupted"));
  assert.equal(await s.runtime.check("manual"), false);
  assert.equal(await s.runtime.check("manual"), false);
  assert.equal(s.runtime.snapshot.consecutiveFailures, 2);
  assert.equal(s.runtime.accepted, accepted);
  s.fail(null);
  s.setNext({ ...s.manifest, sequence: 2, closures: [] });
  assert.equal(await s.runtime.check("manual"), false);
  assert.equal(s.runtime.accepted, accepted);
  s.setNext(s.manifest);
  assert.equal(await s.runtime.check("manual"), true);
  assert.equal(s.runtime.snapshot.consecutiveFailures, 0);
});
test("active rides stage updates, stop does not adopt; fresh check after stop adopts atomically", async () => {
  const s = await setup();
  await s.runtime.check("launch");
  const accepted = s.runtime.accepted;
  s.runtime.setActiveRide(true);
  s.setNext({
    ...s.manifest,
    sequence: 2,
    dataset: { ...s.manifest.dataset, version: "2" },
    closures: [
      ...s.manifest.closures,
      { id: "new-closure", contentSha256: "b".repeat(64) },
    ],
  });
  assert.equal(await s.runtime.check("manual"), true);
  assert.equal(s.runtime.accepted, accepted);
  assert.equal(s.runtime.snapshot.pendingSequence, 2);
  assert.deepEqual(s.disposed, []);
  s.runtime.setActiveRide(false);
  s.fail(Error("offline after stop"));
  assert.equal(
    await s.runtime.start(
      {},
      async () => ({ canNavigate: true }),
      () => assert.fail("unsafe Start"),
    ),
    false,
  );
  assert.equal(s.runtime.accepted, accepted);
  s.fail(null);
  assert.equal(await s.runtime.check("manual"), true);
  assert.equal(s.runtime.accepted?.value, 2);
  assert.equal(s.runtime.snapshot.pendingSequence, null);
  assert.deepEqual(s.disposed, [2, 1]);
});
test("every Start inspects saved route; warnings block; concurrent Start launches only once", async () => {
  const s = await setup();
  let starts = 0,
    inspections = 0;
  assert.equal(
    await s.runtime.start(
      {},
      async () => ({ canNavigate: false }),
      () => starts++,
    ),
    false,
  );
  const inspect = async () => {
    inspections++;
    return { canNavigate: true };
  };
  const results = await Promise.all([
    s.runtime.start({}, inspect, () => starts++),
    s.runtime.start({}, inspect, () => starts++),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(starts, 1);
  assert.equal(inspections, 2);
});
test("tab invalidation during inspection and threshold expiry block Start", async () => {
  const s = await setup();
  let starts = 0;
  assert.equal(
    await s.runtime.start(
      {},
      async () => {
        s.runtime.invalidate();
        return { canNavigate: true };
      },
      () => starts++,
    ),
    false,
  );
  s.advance(86400000);
  assert.equal(
    await s.runtime.start(
      {},
      async () => ({ canNavigate: true }),
      () => starts++,
    ),
    false,
  );
  assert.equal(starts, 0);
});
test("offline and quota errors are visible, accepted data stays, reconnect can recover", async () => {
  const s = await setup();
  s.cacheFail();
  await s.runtime.check("launch");
  assert.match(s.runtime.snapshot.cacheError!, /could not be saved/);
  const accepted = s.runtime.accepted;
  s.runtime.setOffline(true);
  assert.equal(await s.runtime.check("manual"), false);
  assert.equal(s.runtime.accepted, accepted);
  s.runtime.setOffline(false);
  assert.equal(await s.runtime.check("online"), true);
  assert.equal(s.runtime.snapshot.error, null);
});
test("dispose aborts interrupted preparation and disposes late candidate", async () => {
  const { manifest } = await refreshFixture();
  let finish!: (v: PreparedData<number>) => void,
    disposed = 0,
    signal!: AbortSignal;
  const runtime = new RuntimeFreshness<number>({
    readManifest: async () => manifest,
    prepare: async (_m, s) => {
      signal = s;
      return new Promise((resolve) => (finish = resolve));
    },
    now: () => REFRESH_NOW,
  });
  const attempt = runtime.check("launch");
  await new Promise((r) => setTimeout(r, 0));
  runtime.dispose();
  assert.equal(signal.aborted, true);
  finish({ manifest, value: 1, dispose: () => disposed++ });
  assert.equal(await attempt, false);
  assert.equal(runtime.accepted, null);
  assert.equal(disposed, 1);
});
test("mutable manifest bypasses HTTP cache and reports missing, unreadable, timed-out responses", async () => {
  const seen: RequestInit[] = [];
  const fetcher = async (_u: RequestInfo | URL, i?: RequestInit) => {
    seen.push(i!);
    return new Response('{"ok":true}');
  };
  assert.deepEqual(
    await fetchRefreshManifest("url", new AbortController().signal, fetcher),
    { ok: true },
  );
  assert.equal(seen[0].cache, "no-store");
  assert.equal(seen[0].credentials, "same-origin");
  await assert.rejects(
    fetchRefreshManifest(
      "url",
      new AbortController().signal,
      async () => new Response("bad", { status: 404 }),
    ),
    /HTTP 404/,
  );
  await assert.rejects(
    fetchRefreshManifest(
      "url",
      new AbortController().signal,
      async () => new Response("bad"),
    ),
    /timed out/,
  );
  await assert.rejects(
    fetchRefreshManifest(
      "url",
      new AbortController().signal,
      async (_u, i) =>
        new Promise((_r, reject) =>
          i?.signal?.addEventListener("abort", () => reject(Error("aborted"))),
        ),
      1,
    ),
    /timed out/,
  );
});
test("storage hint has only release identity, no data authority or rider history", async () => {
  const { manifest } = await refreshFixture();
  const writes: string[] = [];
  saveRefreshHint({ setItem: (_k, v) => writes.push(v) }, manifest);
  assert.equal(
    canonical(JSON.parse(writes[0])),
    canonical({
      schema: "trail-mapper.refresh-hint/1",
      sequence: 1,
      version: "runtime-1",
    }),
  );
});

test("durable rejection history survives reload, staging and failed storage without adopting cached data", async () => {
  const { manifest: first } = await refreshFixture();
  let next = { ...first, sequence: 2 };
  let floor: RefreshManifest | null = null;
  let failWrite = false;
  const create = () =>
    new RuntimeFreshness<number>({
      now: () => REFRESH_NOW,
      readManifest: async () => next,
      readSafetyFloor: async () => floor,
      commitSafetyFloor: async (m) => {
        if (failWrite) throw Error("Safety history could not be saved");
        floor = m;
      },
      prepare: async (m) => ({ manifest: m, value: m.sequence, dispose() {} }),
    });
  const firstTab = create();
  assert.equal(await firstTab.check("launch"), true);
  const reload = create();
  assert.equal(reload.accepted, null);
  next = first;
  assert.equal(await reload.check("launch"), false);
  assert.equal(reload.accepted, null);
  next = { ...first, sequence: 3, closures: [] };
  assert.equal(await reload.check("manual"), false);
  next = { ...first, sequence: 3 };
  failWrite = true;
  assert.equal(await reload.check("manual"), false);
  assert.equal(reload.accepted, null);
  next = { ...first, sequence: 2 };
  assert.equal(await reload.check("manual"), false);
  next = { ...first, sequence: 3 };
  failWrite = false;
  assert.equal(await reload.check("manual"), true);
  reload.setActiveRide(true);
  next = { ...first, sequence: 4 };
  await reload.check("manual");
  assert.equal((reload.accepted as PreparedData<number> | null)?.value, 3);
  assert.equal((floor as RefreshManifest | null)?.sequence, 4);
  const otherTab = create();
  next = { ...first, sequence: 3 };
  assert.equal(await otherTab.check("launch"), false);
  assert.equal(otherTab.accepted, null);
});
test("review evidence binds exact prior hash, sequences, target and retained history", async () => {
  const { manifest: m } = await refreshFixture();
  const evidence = {
    id: m.closures[0].id,
    fromSequence: 1,
    toSequence: 2,
    fromContentSha256: m.closures[0].contentSha256,
    toContentSha256: null,
    evidenceUrl: "https://example.test/review",
    reviewedBy: "Reviewer",
    reviewedAtUtc: m.releasedAtUtc,
  };
  const reopened = { ...m, sequence: 2, closures: [], reopenings: [evidence] };
  assert.doesNotThrow(() => assertSafeSuccessor(m, reopened));
  for (const patch of [
    { fromSequence: 0 },
    { toSequence: 3 },
    { fromContentSha256: "b".repeat(64) },
    { toContentSha256: "b".repeat(64) },
  ])
    assert.throws(() =>
      assertSafeSuccessor(m, {
        ...reopened,
        reopenings: [{ ...evidence, ...patch }],
      }),
    );
  const reclosed = { ...m, sequence: 3, reopenings: [evidence] };
  assert.doesNotThrow(() => assertSafeSuccessor(reopened, reclosed));
  assert.throws(() =>
    assertSafeSuccessor(reclosed, { ...reopened, sequence: 4 }),
  );
  assert.throws(() =>
    assertSafeSuccessor(reopened, { ...reclosed, reopenings: [] }),
  );
});
test("in-flight lifecycle invalidation visibly requires a later check", async () => {
  const { manifest } = await refreshFixture();
  let interrupted = true;
  const runtime = new RuntimeFreshness<number>({
    now: () => REFRESH_NOW,
    readManifest: async () => {
      if (interrupted) {
        interrupted = false;
        runtime.invalidate();
      }
      return manifest;
    },
    prepare: async (m) => ({ manifest: m, value: 1, dispose() {} }),
  });
  assert.equal(await runtime.check("launch"), false);
  assert.equal(runtime.snapshot.requiresCheck, true);
  assert.match(runtime.snapshot.error!, /changed during this check/);
  assert.equal(runtime.snapshot.successfulCheckAt, REFRESH_NOW);
  assert.equal(await runtime.check("manual"), true);
  assert.equal(runtime.snapshot.error, null);
});
