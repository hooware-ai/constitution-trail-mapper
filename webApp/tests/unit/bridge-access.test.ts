import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Saved-route revalidation and incremental access loading, through the REAL shared Kotlin core. The scenario is
// synthetic: one trail, and ordinary roads that lead to it from a start point off the trail, so the planner splices
// road access into the first trail edge (a connector edge that carries road geometry AND trail geometry).
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
const start = { latitude: 40.4976, longitude: -88.9565 };
const finish = { latitude: 40.508, longitude: -88.95 };

const trail = (lon = -88.95, middle = [-88.95, 40.504]) => ({
  source: {},
  layers: [
    {
      id: 1,
      name: "Synthetic",
      features: [
        {
          id: "t1",
          name: "Synthetic trail",
          status: "Existing",
          routeRoles: ["TrailBranches"],
          facilityType: "Separated Trail",
          comfort: "All Ages and Abilities",
          paths: [
            [
              [lon, 40.5],
              [lon, 40.502],
              middle,
              [lon, 40.506],
              [lon, 40.508],
              [lon, 40.51],
            ],
          ],
        },
      ],
    },
  ],
});
const road = (id: string, paths: number[][][], extra: object = {}) => ({
  id,
  name: "Synthetic road",
  mtfcc: "S1400",
  paths,
  ...extra,
});
const access = (layerId: string, ...features: object[]) =>
  JSON.stringify({ layers: [{ id: layerId, features }] });
const r1 = () =>
  road("tiger:1", [
    [
      [-88.956, 40.4975],
      [-88.953, 40.4975],
      [-88.95, 40.4975],
    ],
  ]);
const r2 = (bend = -88.95) =>
  road("tiger:2", [
    [
      [-88.95, 40.4975],
      [bend, 40.4985],
      [-88.95, 40.5],
    ],
  ]);
const far = (id: string) =>
  road(id, [
    [
      [-88.9, 40.45],
      [-88.899, 40.45],
    ],
  ]);

async function engine() {
  const core: any = await import(pathToFileURL(corePath).href);
  const call = (request: unknown) =>
    JSON.parse(core.dispatch(JSON.stringify(request)));
  const init = (trails: unknown, accessText: string | undefined) => {
    const result = call({
      op: "initialize",
      trails: JSON.stringify(trails),
      ...(accessText === undefined ? {} : { access: accessText }),
      now: NOW,
    });
    assert.equal(result.ok, true);
    return result;
  };
  const plan = () => {
    const planned = call({
      op: "plan",
      start,
      destination: finish,
      proposed: false,
      now: NOW,
    });
    assert.equal(planned.ok, true);
    return planned;
  };
  const check = (route: unknown) =>
    call({ op: "inspect", route, now: NOW }).network;
  return { call, init, plan, check };
}

test(
  "a freshly planned route that splices road access into a trail edge verifies as current",
  { skip },
  async () => {
    const { init, plan, check } = await engine();
    init(trail(), access("tiger", r1(), r2()));
    const planned = plan();
    // The scenario really does put road geometry inside a trail-sourced edge (otherwise this proves nothing).
    const composite = planned.route.edges.find(
      (edge: any) =>
        edge.sourceFeatureId === "t1" &&
        edge.routeSegments.some(
          (s: any) => s.type === "Access" && s.isRouted,
        ) &&
        edge.routeSegments.some((s: any) => s.type === "Trail" && s.isRouted),
    );
    assert.ok(composite, "expected a connector edge carrying road and trail");
    assert.equal(check(planned.route).status, "current");
    assert.equal(planned.network.status, "current");
  },
);

test(
  "a trail that moved or was redrawn, and a road that moved or vanished, still makes the saved route stale",
  { skip },
  async () => {
    const { init, plan, check } = await engine();
    init(trail(), access("tiger", r1(), r2()));
    const route = plan().route;
    const stale = (trails: unknown, accessText: string) => {
      init(trails, accessText);
      const result = check(route);
      assert.equal(result.status, "stale");
      assert.equal(result.issues[0].code, "geometry-changed");
    };
    stale(trail(-88.9497), access("tiger", r1(), r2())); // trail moved ~20 m east
    stale(trail(-88.95, [-88.9497, 40.504]), access("tiger", r1(), r2())); // one vertex redrawn
    stale(trail(), access("tiger", r1(), r2(-88.9497))); // road bend moved
    stale(trail(), access("tiger", r1())); // the connecting road is gone
    // Control: the original data verifies again.
    init(trail(), access("tiger", r1(), r2()));
    assert.equal(check(route).status, "current");
  },
);

test(
  "access added afterwards reaches the planner without re-initializing, and a verified route stays verified",
  { skip },
  async () => {
    const { call, init, plan, check } = await engine();
    init(trail(), access("tiger", r1()));
    const before = plan();
    const added = call({
      op: "addAccess",
      access: access("tiger", r2(), far("tiger:far")),
    });
    assert.deepEqual(
      { ok: added.ok, added: added.added, count: added.accessFeatureCount },
      { ok: true, added: 2, count: 3 },
    );
    const planned = plan();
    assert.equal(check(planned.route).status, "current");
    // Distant, unrelated roads arriving later do not change the verdict on a route planned earlier.
    call({ op: "addAccess", access: access("tiger", far("tiger:far2")) });
    assert.equal(check(planned.route).status, "current");
    // The route planned before the connecting road existed is not a route over it: no hidden borrowing.
    assert.notEqual(
      JSON.stringify(before.route.edges.map((e: any) => e.routeSegments)),
      JSON.stringify(planned.route.edges.map((e: any) => e.routeSegments)),
    );
  },
);

test(
  "addAccess is idempotent and refuses duplicates, changed content and changed metadata, changing nothing when it refuses",
  { skip },
  async () => {
    const { call, init } = await engine();
    init(trail(), access("tiger", r1(), r2()));
    const count = () =>
      call({ op: "addAccess", access: access("tiger") }).accessFeatureCount;
    assert.equal(count(), 2);
    const add = (text: string) => call({ op: "addAccess", access: text });

    // Re-sending what is already loaded is a no-op.
    assert.equal(add(access("tiger", r1())).added, 0);
    // The same new road twice in one batch (identical) is added once.
    const x = far("tiger:x");
    assert.equal(add(access("tiger", x, x)).added, 1);
    assert.equal(count(), 3);

    const refused = (text: string, pattern: RegExp) => {
      const result = add(text);
      assert.equal(result.ok, false);
      assert.match(result.error, pattern);
      assert.equal(
        count(),
        3,
        "a refused batch must not change what is loaded",
      );
    };
    // Same id twice in one batch with different content.
    refused(
      access("tiger", far("tiger:y"), { ...far("tiger:y"), name: "Other" }),
      /twice with different content/,
    );
    // Changed geometry, name or class under a loaded id.
    refused(access("tiger", r2(-88.9497)), /different content/);
    refused(access("tiger", { ...r1(), name: "Renamed" }), /different content/);
    refused(access("tiger", { ...r1(), mtfcc: "S1740" }), /different content/);
    // Changed endpoint-local status (a service road is only loaded near endpoints).
    refused(access("osm-service", r1()), /different content/);
    // A valid new road in the same batch as a conflict is NOT added.
    refused(
      access("tiger", far("tiger:z"), { ...r1(), name: "Renamed" }),
      /different content/,
    );
    assert.equal(add(access("tiger", far("tiger:z"))).added, 1);
  },
);

test(
  "a refused addAccess does not leak endpoint-local status onto roads that arrive later",
  { skip },
  async () => {
    const { call, init } = await engine();
    init(trail(), access("tiger", r1(), r2()));
    const add = (text: string) => call({ op: "addAccess", access: text });
    // A batch that declares a NEW service road and then conflicts must leave no trace of the road's local status.
    const refused = add(
      JSON.stringify({
        layers: [
          { id: "osm-service", features: [far("osm:way:1")] },
          { id: "tiger", features: [{ ...r1(), name: "Renamed" }] },
        ],
      }),
    );
    assert.equal(refused.ok, false);
    assert.equal(add(access("tiger", far("osm:way:1"))).added, 1);
    // It was recorded as an ordinary road, so claiming it is a service road now is a metadata change.
    const again = add(access("osm-service", far("osm:way:1")));
    assert.equal(again.ok, false);
    assert.match(again.error, /different content/);
  },
);

test(
  "addAccess needs a loaded dataset and a replacement dataset starts from its own access data",
  { skip },
  async () => {
    const { call, init, plan, check } = await engine();
    // Before any dataset is loaded the operation is refused.
    call({ op: "initialize", trails: "{}", now: NOW });
    assert.equal(
      call({ op: "addAccess", access: access("tiger", r1()) }).ok,
      false,
    );
    init(trail(), access("tiger", r1(), r2()));
    const route = plan().route;
    call({ op: "addAccess", access: access("tiger", far("tiger:far")) });
    // Re-initializing drops what was added: the new dataset owns its access data.
    const reloaded = init(trail(), access("tiger", r1(), r2()));
    assert.equal(reloaded.accessFeatureCount, 2);
    assert.equal(check(route).status, "current");
  },
);
