import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// "Reverse direction" through the REAL shared Kotlin core: the same loop ridden the other way, as native does it.
const corePath = join(
  resolve(process.cwd(), ".."),
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
const east = { latitude: 40.51, longitude: -88.95 };
const west = { latitude: 40.49, longitude: -88.99 };

async function engine() {
  const module: any = await import(pathToFileURL(corePath).href + "?reverse=1");
  const call = (request: unknown) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  const trails = readFileSync(
    join(process.cwd(), "src", "data", "review-network.json"),
    "utf8",
  );
  const init = call({
    op: "initialize",
    trails,
    trustSerializedRoutes: true,
    now: NOW,
  });
  assert.equal(init.ok, true);
  return call;
}

const ends = (route: any) => {
  const first = route.segments[0].points[0];
  const lastSegment = route.segments[route.segments.length - 1];
  return { first, last: lastSegment.points[lastSegment.points.length - 1] };
};

test(
  "a loop ridden in reverse is the same loop backwards, and reversing twice restores it",
  { skip },
  () => {
    const call = engine();
    return call.then((dispatch: any) => {
      const loop = dispatch({
        op: "plan",
        start: east,
        miles: 5,
        proposed: false,
        now: NOW,
      });
      assert.equal(loop.ok, true);
      const reversed = dispatch({ op: "reverse", route: loop.route, now: NOW });
      assert.equal(reversed.ok, true);
      // Same distance and kind; start and finish swap; every segment's geometry is reversed.
      assert.equal(reversed.route.kind, "ExerciseLoop");
      assert.equal(
        reversed.route.totalDistanceMeters,
        loop.route.totalDistanceMeters,
      );
      assert.deepEqual(ends(reversed.route).first, ends(loop.route).last);
      assert.deepEqual(ends(reversed.route).last, ends(loop.route).first);
      assert.deepEqual(
        reversed.route.segments.map((s: any) => s.points),
        [...loop.route.segments]
          .reverse()
          .map((s: any) => [...s.points].reverse()),
      );
      assert.notDeepEqual(reversed.route.segments, loop.route.segments);
      // It is described afresh, so it can be navigated exactly when the loop could be, with its own instructions.
      assert.equal(reversed.canNavigate, loop.canNavigate);
      assert.ok(
        Array.isArray(reversed.instructions) &&
          reversed.instructions.length > 0,
      );
      // The reversed geometry is verified against the loaded network like any route (orientation does not matter).
      assert.equal(reversed.network.status, "current");
      const again = dispatch({
        op: "reverse",
        route: reversed.route,
        now: NOW,
      });
      assert.deepEqual(again.route.segments, loop.route.segments);
      assert.deepEqual(again.route.edges, loop.route.edges);
    });
  },
);

test("only an exercise loop can be reversed", { skip }, async () => {
  const dispatch = await engine();
  const pair = dispatch({
    op: "plan",
    start: west,
    destination: east,
    proposed: false,
    now: NOW,
  });
  assert.equal(pair.ok, true);
  const refused = dispatch({ op: "reverse", route: pair.route, now: NOW });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Only an exercise loop can be ridden in reverse/);
});

// ---- a reversal never makes a blocked route navigable, in either direction -------------------------------------------

const BEFORE_CLOSURE = 1_789_966_800_000 - 86_400_000;
const DURING_CLOSURE = Date.parse("2026-10-01T15:00:00Z");
const CORRIDOR: [number, number][] = [
  [40.507656, -88.984202],
  [40.507674, -88.984137],
  [40.507662, -88.984056],
  [40.507656, -88.983955],
  [40.507679, -88.983837],
  [40.507719, -88.983807],
  [40.508049, -88.983831],
  [40.508151, -88.983809],
  [40.508292, -88.983692],
  [40.508501, -88.983851],
  [40.508589, -88.983823],
  [40.50917, -88.982741],
  [40.509338, -88.982564],
  [40.50954, -88.982576],
  [40.508798, -88.983965],
  [40.509023, -88.984155],
];
const ringFeature = (id: string, points: [number, number][]) => ({
  id,
  name: id,
  status: "Existing",
  routeRoles: ["TrailBranches"],
  facilityType: "Separated Trail",
  comfort: "All Ages and Abilities",
  paths: [points.map(([lat, lon]) => [lon, lat])],
});

test(
  "a loop over the Uptown closure is blocked in BOTH directions once the closure is active",
  { skip },
  async () => {
    const module: any = await import(
      pathToFileURL(corePath).href + "?reverse=ring"
    );
    const call = (request: unknown) =>
      JSON.parse(module.dispatch(JSON.stringify(request)));
    const A: [number, number] = [40.507656, -88.984202];
    const B: [number, number] = [40.509023, -88.984155];
    const ring = {
      source: {},
      layers: [
        {
          id: 54,
          name: "Synthetic",
          features: [
            ringFeature("54:1305", CORRIDOR),
            ringFeature("54:9300", [
              B,
              [40.5091, -88.9885],
              [40.5075, -88.9885],
              A,
            ]),
          ],
        },
      ],
    };
    assert.equal(
      call({
        op: "initialize",
        trails: JSON.stringify(ring),
        now: DURING_CLOSURE,
      }).ok,
      true,
    );
    const loop = call({
      op: "plan",
      start: { latitude: A[0], longitude: A[1] },
      miles: 0.9,
      proposed: false,
      now: BEFORE_CLOSURE,
    });
    assert.equal(loop.ok, true);
    assert.equal(
      loop.canNavigate,
      true,
      "before the closure the loop can be ridden",
    );
    assert.ok(
      loop.route.edges.some((e: any) => e.sourceFeatureId === "54:1305"),
    );
    assert.equal(
      call({ op: "reverse", route: loop.route, now: BEFORE_CLOSURE })
        .canNavigate,
      true,
    );

    const forward = call({
      op: "inspect",
      route: loop.route,
      now: DURING_CLOSURE,
    });
    const reversed = call({
      op: "reverse",
      route: loop.route,
      now: DURING_CLOSURE,
    });
    assert.equal(forward.canNavigate, false);
    assert.equal(reversed.ok, true);
    assert.equal(
      reversed.canNavigate,
      false,
      "reversing does not make a closed loop navigable",
    );
    assert.equal(reversed.closures[0].id, "uptown-underpass-detour-2026-09-21");
    assert.deepEqual(
      reversed.closures.map((c: any) => c.id),
      forward.closures.map((c: any) => c.id),
    );
  },
);

test(
  "a loop whose trail data has since changed is stale in BOTH directions, so a reversal cannot revive it",
  { skip },
  async () => {
    const module: any = await import(
      pathToFileURL(corePath).href + "?reverse=stale"
    );
    const call = (request: unknown) =>
      JSON.parse(module.dispatch(JSON.stringify(request)));
    const original = readFileSync(
      join(process.cwd(), "src", "data", "review-network.json"),
      "utf8",
    );
    assert.equal(
      call({ op: "initialize", trails: original, now: NOW }).ok,
      true,
    );
    const loop = call({
      op: "plan",
      start: east,
      miles: 3,
      proposed: false,
      now: NOW,
    });
    assert.equal(loop.canNavigate, true);
    assert.equal(
      call({ op: "reverse", route: loop.route, now: NOW }).canNavigate,
      true,
    );
    // The same network with every trail moved about 20 m: the loop no longer lies on the data that is loaded now.
    const moved = JSON.parse(original);
    for (const layer of moved.layers)
      for (const feature of layer.features)
        feature.paths = feature.paths.map((path: number[][]) =>
          path.map(([lon, lat]) => [lon + 0.0002, lat]),
        );
    assert.equal(
      call({ op: "initialize", trails: JSON.stringify(moved), now: NOW }).ok,
      true,
    );
    const forward = call({ op: "inspect", route: loop.route, now: NOW });
    const reversed = call({ op: "reverse", route: loop.route, now: NOW });
    assert.equal(forward.canNavigate, false);
    assert.equal(forward.network.status, "stale");
    assert.equal(reversed.canNavigate, false);
    assert.equal(reversed.network.status, "stale");
  },
);
