import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AccessPackageError,
  buildAccessParts,
  cellOf as packageCellOf,
  cellsOfFeature,
  checkAccessParts,
} from "../../tools/lib/access-package.mjs";
import {
  AccessLoader,
  AccessSession,
  accessPointsOf,
  cellOf,
  requiredCells,
  type AccessDeps,
} from "../../src/accessTiles";
import { DatasetError } from "../../src/dataset";

// The lazy access delivery, end to end through the REAL Kotlin core and the real packager. The data is synthetic: two
// small trails, TIGER-style base roads, and endpoint-local service roads (layer "osm-service") around them.
const root = resolve(process.cwd(), "..");
const corePath = join(
  root,
  "webBridge",
  "build",
  "dist",
  "js",
  "productionLibrary",
  "TrailMapper-webBridge.mjs",
);
const skip = existsSync(corePath)
  ? false
  : "the Kotlin core is not built (npm run build:core)";
const NOW = Date.parse("2026-10-01T15:00:00Z");

const trails = {
  source: {},
  layers: [
    {
      id: 1,
      name: "Synthetic",
      features: [
        ["t1", -88.95, 40.5],
        ["t2", -88.8, 40.6],
      ].map(([id, lon, lat]) => ({
        id,
        name: `Synthetic trail ${id}`,
        status: "Existing",
        routeRoles: ["TrailBranches"],
        facilityType: "Separated Trail",
        comfort: "All Ages and Abilities",
        paths: [
          [0, 0.002, 0.004, 0.006, 0.008, 0.01].map((d) => [
            lon as number,
            (lat as number) + d,
          ]),
        ],
      })),
    },
  ],
};
const road = (id: string, ...points: number[][]) => ({
  id,
  name: "Synthetic road",
  mtfcc: "S1400",
  paths: [points],
});
const base = [
  road("tiger:1", [-88.956, 40.4975], [-88.95, 40.4975]),
  road("tiger:2", [-88.95, 40.4975], [-88.95, 40.5]),
  road("tiger:3", [-88.806, 40.5975], [-88.8, 40.5975]),
  road("tiger:4", [-88.8, 40.5975], [-88.8, 40.6]),
];
const service = [
  road("osm:s1", [-88.9625, 40.4975], [-88.956, 40.4975]), // joins the west end of tiger:1, crosses a cell edge
  road("osm:s2", [-88.8125, 40.5975], [-88.806, 40.5975]), // the same, in a second, distant area
  // Nine kilometres east to west with vertices only at its ends: its centroid is far from where it is needed.
  road("osm:long", [-88.99, 40.48], [-88.9, 40.48]),
  // A service road in a cell no trip below ever touches.
  road("osm:unused", [-88.7, 40.3], [-88.699, 40.3]),
];
const extract = JSON.stringify({
  layers: [
    { id: "tiger", features: base },
    { id: "osm-service", features: service },
  ],
});
const start1 = { latitude: 40.4976, longitude: -88.9626 };
const finish1 = { latitude: 40.508, longitude: -88.95 };
const start2 = { latitude: 40.5976, longitude: -88.8126 };
const finish2 = { latitude: 40.608, longitude: -88.8 };

const sha = (bytes: ArrayBuffer | Buffer) =>
  createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const trailsText = JSON.stringify(trails);

let instances = 0;
/** A separate instance of the core each time (its state is per module instance), so a reference never shares state. */
async function core() {
  const module: any = await import(
    `${pathToFileURL(corePath).href}?instance=${++instances}`
  );
  const call = (request: unknown) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  return call as (request: any) => any;
}

/** The shared world: package once, serve the files from memory with switches for failure injection. */
function site(built = buildAccessParts(extract)) {
  const files = new Map(built.files.map((f) => [f.file, f.body]));
  const state = {
    requests: [] as string[],
    offline: false,
    tamper: new Set<string>(),
    missing: new Set<string>(),
    delay: new Map<string, Promise<void>>(),
  };
  const deps = (call: (r: any) => any): AccessDeps & { log: string[] } => {
    const log: string[] = [];
    return {
      log,
      async fetchBytes(file) {
        state.requests.push(file);
        log.push(`fetch ${file}`);
        const wait = state.delay.get(file);
        if (wait) await wait;
        if (state.offline) throw new TypeError("network down");
        if (state.missing.has(file))
          throw new DatasetError("data-missing", "missing");
        const body = files.get(file);
        if (!body) throw new DatasetError("data-missing", "missing");
        const copy = new Uint8Array(body);
        if (state.tamper.has(file)) copy[copy.length - 3] ^= 1;
        return copy.buffer;
      },
      async sha256Hex(bytes) {
        return sha(bytes);
      },
      dispatch(request) {
        if (request.op === "addAccess") log.push("addAccess");
        return call(request);
      },
    };
  };
  return { built, files, state, deps };
}

const initialize = (call: (r: any) => any, access: string) => {
  const result = call({
    op: "initialize",
    trails: trailsText,
    access,
    now: NOW,
  });
  assert.equal(result.ok, true);
  return result;
};
const planRequest = (start: any, destination: any) => ({
  op: "plan",
  start,
  destination,
  proposed: false,
  now: NOW,
});

/** Core booted the way the worker does it: trails and the BASE roads only, then a session that loads tiles on demand. */
async function lazy(s = site()) {
  const call = await core();
  const loader = new AccessLoader(s.built.descriptor, s.deps(call));
  initialize(call, await loader.baseText());
  const session = new AccessSession(loader, (request) => call(request));
  return { call, loader, session, s };
}
/** The reference: every road, loaded up front (what native does, and what the web did before tiles). */
async function monolithic() {
  const call = await core();
  initialize(call, extract);
  return call;
}

// ---- packaging ---------------------------------------------------------------------------------------------------

test("the access package is deterministic, hash-named, compact, and splits service roads from base roads", () => {
  const a = buildAccessParts(extract);
  const b = buildAccessParts(extract);
  assert.deepEqual(
    a.files.map((f) => [f.file, f.body.toString("hex")]),
    b.files.map((f) => [f.file, f.body.toString("hex")]),
  );
  for (const part of [a.base, a.index, ...a.tiles])
    assert.ok(part.file.includes(part.sha256.slice(0, 12)));
  // Compact JSON: no pretty-printing whitespace in any part.
  for (const f of a.files) assert.doesNotMatch(f.body.toString(), /\n|": /);
  const baseIds = JSON.parse(a.base.body.toString()).layers.flatMap((l: any) =>
    l.features.map((f: any) => f.id),
  );
  assert.deepEqual(baseIds.sort(), base.map((f) => f.id).sort());
  assert.equal(a.descriptor.index.localFeatureCount, service.length);
  checkAccessParts(a.descriptor, (file) =>
    new Map(a.files.map((f) => [f.file, f.body])).get(file),
  );
});

test("a long road is written to EVERY cell its bounding box intersects, never by centroid", () => {
  const built = buildAccessParts(extract);
  const long = service[2];
  const expected = cellsOfFeature(long as any);
  assert.ok(expected.length >= 9, "the road spans many cells");
  const holders = built.tiles.filter((tile) =>
    JSON.parse(tile.body.toString()).layers[0].features.some(
      (f: any) => f.id === "osm:long",
    ),
  );
  assert.deepEqual(
    holders.map((t) => `${t.lat}_${t.lon}`).sort(),
    expected.map(([lat, lon]) => `${lat}_${lon}`).sort(),
  );
});

test("the audit refuses altered, missing and mis-assigned access parts", () => {
  const built = buildAccessParts(extract);
  const read = (altered: Map<string, Buffer>) => (file: string) =>
    altered.get(file);
  const fresh = () =>
    new Map(built.files.map((f) => [f.file, Buffer.from(f.body)]));
  const refused = (altered: Map<string, Buffer>) =>
    assert.throws(
      () => checkAccessParts(built.descriptor, read(altered)),
      AccessPackageError,
    );
  let files = fresh();
  files.get(built.tiles[0].file)![5] ^= 1;
  refused(files); // a flipped byte
  files = fresh();
  files.delete(built.tiles[1].file);
  refused(files); // a missing tile
  files = fresh();
  files.delete(built.base.file);
  refused(files); // a missing base
  // A road removed from one of the cells its bounding box intersects (a centroid-style packaging) is refused even when
  // the file is rehashed consistently, because the index and record would have to change too.
  const trimmed = buildAccessParts(
    JSON.stringify({
      layers: [
        { id: "tiger", features: base },
        { id: "osm-service", features: [service[2]] },
      ],
    }),
  );
  const tile = trimmed.tiles[3];
  const doctored = JSON.parse(tile.body.toString());
  doctored.layers[0].features = [];
  const body = Buffer.from(JSON.stringify(doctored));
  const copy = new Map(trimmed.files.map((f) => [f.file, f.body]));
  copy.set(tile.file, body);
  assert.throws(
    () => checkAccessParts(trimmed.descriptor, (file) => copy.get(file)),
    AccessPackageError,
  );
  assert.throws(
    () =>
      buildAccessParts(
        JSON.stringify({
          layers: [
            { id: "tiger", features: base },
            {
              id: "osm-service",
              features: [road("osm:north", [0, 70], [0.1, 70])],
            },
          ],
        }),
      ),
    AccessPackageError,
  );
  assert.throws(() => buildAccessParts("{"), AccessPackageError);
});

test("the packager and the browser loader agree on which cell a coordinate is in", () => {
  for (const lat of [40.0, 40.4976, 40.5, 40.51, -33.87, 0, 55.999])
    for (const lon of [-88.9626, -88.95, -88.9, 0, 12.345, -0.0001])
      assert.deepEqual(
        cellOf({ latitude: lat, longitude: lon }),
        packageCellOf(lat, lon),
      );
});

// ---- equivalence with the native 600 m rule ----------------------------------------------------------------------

const toMeters = (a: number[], b: number[]) =>
  Math.hypot((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) *
  111320;
function distanceToRoad(
  point: { latitude: number; longitude: number },
  feature: any,
) {
  const p = [point.longitude, point.latitude];
  let best = Infinity;
  for (const path of feature.paths)
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
      const dy = b[1] - a[1];
      const px = (p[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180);
      const py = p[1] - a[1];
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(px - t * dx, py - t * dy) * 111320);
    }
  return best;
}

test(
  "every service road within the native 600 m rule of an endpoint is loaded, at cell edges, corners and the boundary",
  { skip },
  async () => {
    const { call, loader } = await lazy();
    const seen = new Set<string>();
    // Spy on what actually reaches the core.
    const original = (loader as any).deps.dispatch;
    (loader as any).deps.dispatch = (request: any) => {
      if (request.op === "addAccess")
        for (const layer of JSON.parse(request.access).layers)
          for (const f of layer.features) seen.add(f.id);
      return original(request);
    };
    const points: { latitude: number; longitude: number }[] = [
      start1,
      finish1,
      start2,
      // Cell corners and edges (multiples of 0.01 degrees), and exactly 599 m and 601 m west of a road end.
      { latitude: 40.5, longitude: -88.96 },
      { latitude: 40.49, longitude: -88.97 },
      { latitude: 40.4799999, longitude: -88.9500001 },
      { latitude: 40.4975, longitude: -88.9625 - 599 / 84720 },
      { latitude: 40.4975, longitude: -88.9625 - 601 / 84720 },
      { latitude: 40.48, longitude: -88.945 }, // the middle of the long road
      { latitude: 40.4805, longitude: -88.97 }, // near it, far from its centroid
      { latitude: 40.3, longitude: -88.7 },
      { latitude: 41.0, longitude: -88.0 }, // nowhere near anything
    ];
    for (const point of points) {
      await loader.ensure([point]);
      for (const feature of service)
        if (distanceToRoad(point, feature) <= 650)
          assert.ok(
            seen.has(feature.id),
            `${feature.id} is within 650 m of ${JSON.stringify(point)} but was not loaded`,
          );
    }
    void call;
  },
);

test(
  "lazy and monolithic loading plan identical routes, including a route that needs a service road",
  { skip },
  async () => {
    const reference = await monolithic();
    const { session } = await lazy();
    for (const [a, b] of [
      [start1, finish1],
      [start2, finish2],
      [start1, finish1], // again, after the second area was loaded
    ]) {
      const expected = reference(planRequest(a, b));
      const actual = (await session.run(planRequest(a, b))) as any;
      assert.equal(actual.ok, true);
      assert.deepEqual(actual.route, expected.route);
      assert.equal(actual.canNavigate, expected.canNavigate);
    }
    // The service road really matters here: without it the first route is a different one.
    const without = await core();
    initialize(
      without,
      JSON.stringify({ layers: [{ id: "tiger", features: base }] }),
    );
    assert.notDeepEqual(
      without(planRequest(start1, finish1)).route,
      reference(planRequest(start1, finish1)).route,
    );
  },
);

// ---- cost and bounds ---------------------------------------------------------------------------------------------

test(
  "opening the planner fetches only the base roads; a trip fetches the index and the tiles around its endpoints, once",
  { skip },
  async () => {
    const s = site();
    const { loader, session } = await lazy(s);
    assert.deepEqual(s.state.requests, [s.built.base.file]);
    await session.run(planRequest(start1, finish1));
    const afterFirst = [...s.state.requests];
    assert.ok(afterFirst.includes(s.built.index.file));
    const tilesFetched = afterFirst.filter((f) => f.startsWith("access-tile."));
    // Bounded by the 3x3 windows around the two endpoints, and far fewer than the whole package.
    assert.ok(tilesFetched.length <= 18);
    assert.ok(tilesFetched.length < s.built.tiles.length);
    const bytes = loader.fetched.reduce((n, f) => n + f.bytes, 0);
    const total = s.built.files.reduce((n, f) => n + f.body.length, 0);
    assert.ok(bytes < total, "a trip does not download the whole package");
    // The same trip again costs nothing.
    await session.run(planRequest(start1, finish1));
    assert.deepEqual(s.state.requests, afterFirst);
    // Every file asked for is one the pinned record names.
    const named = new Set(s.built.files.map((f) => f.file));
    for (const file of s.state.requests) assert.ok(named.has(file), file);
  },
);

test(
  "successive distant plans load only what each needs and keep what was loaded",
  { skip },
  async () => {
    const s = site();
    const { loader, session } = await lazy(s);
    await session.run(planRequest(start1, finish1));
    const first = new Set(loader.loadedCells);
    await session.run(planRequest(start2, finish2));
    const second = new Set(loader.loadedCells);
    assert.ok(second.size > first.size);
    for (const cell of first) assert.ok(second.has(cell));
    const before = s.state.requests.length;
    await session.run(planRequest(start1, finish1));
    assert.equal(s.state.requests.length, before);
  },
);

// ---- failure: integrity, offline, retry --------------------------------------------------------------------------

test(
  "a tile that fails its hash, or cannot be downloaded, is never used, is reported, and is retried cleanly",
  { skip },
  async () => {
    const s = site();
    const { loader, session, call } = await lazy(s);
    const victim = s.built.tiles.find((tile) =>
      JSON.parse(tile.body.toString()).layers[0].features.some(
        (f: any) => f.id === "osm:s1",
      ),
    )!;
    s.state.tamper.add(victim.file);
    await assert.rejects(
      session.run(planRequest(start1, finish1)),
      (e: any) => {
        assert.equal(e.code, "data-corrupt");
        assert.match(e.message, /integrity check/);
        return true;
      },
    );
    assert.ok(!loader.loadedCells.includes(`${victim.lat}_${victim.lon}`));
    s.state.tamper.clear();
    s.state.offline = true;
    await assert.rejects(
      session.run(planRequest(start1, finish1)),
      (e: any) => {
        assert.equal(e.code, "data-unavailable");
        assert.match(e.message, /Check your connection and retry/);
        return true;
      },
    );
    // Back online: the very next operation succeeds on the very same session, and matches the reference.
    s.state.offline = false;
    const retried = (await session.run(planRequest(start1, finish1))) as any;
    const reference = await monolithic();
    assert.deepEqual(
      retried.route,
      reference(planRequest(start1, finish1)).route,
    );
    void call;
    // A missing file is reported as missing, not as corruption.
    const s2 = site();
    const second = await lazy(s2);
    s2.state.missing.add(s2.built.index.file);
    await assert.rejects(
      second.session.run(planRequest(start1, finish1)),
      (e: any) => e.code === "data-missing",
    );
  },
);

test(
  "a tile index that belongs to a different dataset is refused",
  { skip },
  async () => {
    const s = site();
    const other = buildAccessParts(
      JSON.stringify({
        layers: [
          { id: "tiger", features: [base[0], base[1]] },
          { id: "osm-service", features: service },
        ],
      }),
    );
    // The record points at the OTHER package's index while its own base is pinned: they disagree and must not mix.
    const mixed = {
      ...s.built.descriptor,
      index: other.descriptor.index,
    };
    const files = new Map([
      ...s.files,
      ...new Map(other.files.map((f) => [f.file, f.body])),
    ]);
    const call = await core();
    const loader = new AccessLoader(mixed, {
      async fetchBytes(file) {
        const body = files.get(file)!;
        return new Uint8Array(body).buffer;
      },
      async sha256Hex(bytes) {
        return sha(bytes);
      },
      dispatch: (request) => call(request),
    });
    initialize(call, await loader.baseText());
    await assert.rejects(
      loader.ensure([start1]),
      (e: any) => e.code === "data-corrupt",
    );
  },
);

// ---- ownership: serialization, cancellation, restart, restored rides, reroutes -----------------------------------

test(
  "operations run one at a time: one trip's road loading and dispatch are not split by another's, and a failure does not poison the queue",
  { skip },
  async () => {
    const s = site();
    const { session, loader } = await lazy(s);
    const call = await core();
    void call;
    // Hold the first trip's tiles back while a second trip is submitted.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const indexFile = s.built.index.file;
    s.state.delay.set(indexFile, gate);
    const order: string[] = [];
    const first = session
      .run(planRequest(start1, finish1))
      .then((r) => (order.push("first"), r));
    const second = session
      .run(planRequest(start2, finish2))
      .then((r) => (order.push("second"), r));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(
      order,
      [],
      "nothing completes while the first trip waits for its roads",
    );
    release();
    const [a, b] = (await Promise.all([first, second])) as any[];
    assert.deepEqual(order, ["first", "second"]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    const reference = await monolithic();
    assert.deepEqual(a.route, reference(planRequest(start1, finish1)).route);
    assert.deepEqual(b.route, reference(planRequest(start2, finish2)).route);
    // A failed operation, then a good one, on the same session.
    s.state.offline = true;
    const farAway = { latitude: 40.3, longitude: -88.7 };
    await assert.rejects(session.run(planRequest(farAway, farAway)));
    s.state.offline = false;
    const fine = (await session.run(planRequest(start1, finish1))) as any;
    assert.equal(fine.ok, true);
    void loader;
  },
);

test(
  "addAccess calls from different operations never land between one operation's loading and its dispatch",
  { skip },
  async () => {
    const s = site();
    const call = await core();
    const deps = s.deps(call);
    const loader = new AccessLoader(s.built.descriptor, deps);
    initialize(call, await loader.baseText());
    const events: string[] = [];
    const session = new AccessSession(loader, (request) => {
      events.push(`dispatch ${request.op} ${JSON.stringify(request.start)}`);
      return call(request);
    });
    const originalDispatch = deps.dispatch;
    deps.dispatch = (request) => {
      if (request.op === "addAccess") events.push("addAccess");
      return originalDispatch(request);
    };
    await Promise.all([
      session.run(planRequest(start1, finish1)),
      session.run(planRequest(start2, finish2)),
    ]);
    const firstPlan = events.findIndex((e) => e.startsWith("dispatch plan"));
    const secondPlan = events
      .map((e) => e.startsWith("dispatch plan"))
      .lastIndexOf(true);
    assert.ok(firstPlan > 0);
    // The second trip's addAccess calls all come after the first trip has been dispatched.
    const lateAdds = events
      .slice(firstPlan + 1, secondPlan)
      .filter((e) => e === "addAccess");
    assert.ok(lateAdds.length > 0);
    assert.ok(events.slice(0, firstPlan).every((e) => e === "addAccess"));
  },
);

test(
  "after a worker restart the pinned replacement loads the same roads on demand, and a restored ride verifies against them",
  { skip },
  async () => {
    const s = site();
    const first = await lazy(s);
    const planned = (await first.session.run(
      planRequest(start1, finish1),
    )) as any;
    assert.equal(planned.network.status, "current");
    const route = planned.route;

    // "Restart": a brand new core state booted from the same pinned package (only the base roads), and a new session.
    const reboot = await lazy(s);
    // Without loading the route's own area the saved route cannot be honoured: that is why the session loads it.
    const bare = reboot.call({ op: "inspect", route, now: NOW });
    assert.notEqual(bare.network.status, "current");
    const restored = (await reboot.session.run({
      op: "inspect",
      route,
      now: NOW,
    })) as any;
    assert.equal(restored.network.status, "current");
    // Same identity of data: nothing but files the pinned record names was ever asked for.
    const named = new Set(s.built.files.map((f) => f.file));
    for (const file of s.state.requests) assert.ok(named.has(file));
  },
);

test(
  "a reroute and a recalculation load the roads around the rider and the route's own endpoints first",
  { skip },
  async () => {
    const reference = await monolithic();
    const planned = reference(planRequest(start1, finish1));
    const rider = { latitude: 40.5, longitude: -88.9502 };
    const rerouteRequest = {
      op: "reroute",
      route: planned.route,
      point: rider,
      mode: "destination",
      now: NOW,
    };
    assert.deepEqual(
      accessPointsOf(rerouteRequest as any).length >= 3,
      true,
      "rider, route start and route end",
    );
    const { session } = await lazy();
    const expected = reference(rerouteRequest);
    const actual = (await session.run(rerouteRequest)) as any;
    assert.equal(actual.ok, expected.ok);
    assert.deepEqual(actual.route, expected.route);
    const recalcRequest = { op: "recalculate", route: planned.route, now: NOW };
    const expectedRecalc = reference(recalcRequest);
    const actualRecalc = (await session.run(recalcRequest)) as any;
    assert.equal(actualRecalc.ok, expectedRecalc.ok);
    assert.deepEqual(actualRecalc.route, expectedRecalc.route);
  },
);

test("the cell window math: a 3x3 block, no repeats, and every point of the block is within reach", () => {
  const cells = requiredCells([start1, start1, finish1], 1);
  assert.equal(new Set(cells.map(([a, b]) => `${a}_${b}`)).size, cells.length);
  assert.ok(cells.length <= 18 && cells.length >= 9);
  assert.equal(
    requiredCells([{ latitude: 40.4976, longitude: -88.9626 }], 1).length,
    9,
  );
});
