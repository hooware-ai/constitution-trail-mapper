import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The timed notices of October 2026 through the REAL shared Kotlin core (the built webBridge), at their distinct
// instants. Nothing is mocked: a missing core makes these tests SKIP and the release check refuses a build without one,
// so a skip here is not an acceptance. Times are exact instants (America/Chicago, CDT):
//  * Willow Street trail closure (Normal 3356): 2026-10-05 06:00 CDT = 11:00Z, estimated 2026-10-19 17:00 CDT = 22:00Z.
//    Blocking from its start, mapped inside the unchanged 790 m source leg 97->98 of county trail 54:1305.
//  * Virginia/Camelback trail crossing (Normal 3353): 2026-10-05 08:00 CDT = 13:00Z, estimated 2026-10-06 17:00 CDT =
//    22:00Z. A known closed CROSSING on county trail 54:1305: no interval is cut (no limits are published and the city
//    line is a road line), but a route that travels through the crossing cannot start from the instant, estimate or not.
//  * An estimate never reopens anything.
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

const WILLOW_START = Date.parse("2026-10-05T11:00:00Z");
const WILLOW_END = Date.parse("2026-10-19T22:00:00Z");
const CAMEL_START = Date.parse("2026-10-05T13:00:00Z");
const CAMEL_END = Date.parse("2026-10-06T22:00:00Z");
const RAAB_START = Date.parse("2026-10-03T11:00:00Z");
const HAMILTON_END = Date.parse("2026-10-31T23:00:00Z");
const WILLOW_ID = "willow-trail-crossing-2026-10-05";
const CAMEL_ID = "camelback-virginia-trail-crossing-2026-10-05";

// The ACTUAL raw source leg 97 -> 98 of county trail 54:1305, path 0: two unchanged source vertices (lat, lon) and
// nothing inserted between them.
const V97 = { latitude: 40.5096012799, longitude: -88.9843690241 };
const V98 = { latitude: 40.516684074, longitude: -88.9849653323 };
// The official closure map line projected onto that leg (about 202.5 m apart): approximate, never source vertices.
const FROM = { latitude: 40.5131086201, longitude: -88.9846643109 };
const TO = { latitude: 40.5149242085, longitude: -88.9848171673 };

const lonLat = (p: { latitude: number; longitude: number }) => [
  p.longitude,
  p.latitude,
];
const feature = (
  id: string,
  points: { latitude: number; longitude: number }[],
  roles = ["TrailBranches"],
) => ({
  id,
  name: `Synthetic ${id}`,
  status: "Existing",
  routeRoles: roles,
  facilityType: "Separated Trail",
  comfort: "All Ages and Abilities",
  paths: [points.map(lonLat)],
});
const network = (...features: object[]) => ({
  source: {},
  layers: [{ id: 54, name: "Synthetic", features }],
});

let instances = 0;
async function engine(
  trails: object | string,
  now = WILLOW_START - 86_400_000,
) {
  const module: any = await import(
    `${pathToFileURL(corePath).href}?timed=${++instances}`
  );
  const call = (request: unknown) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  const init = call({
    op: "initialize",
    trails: typeof trails === "string" ? trails : JSON.stringify(trails),
    now,
  });
  assert.equal(init.ok, true);
  return { call, init };
}
const plan = (call: any, start: object, destination: object, now: number) =>
  call({ op: "plan", start, destination, proposed: false, now });
/**
 * The point the app's own map picker returns for a tap: projected onto the loaded trail at that instant. Routes the way
 * a rider actually plans them start and end on such points; a raw coordinate that is 0.07 m off the planner's own
 * projection is an estimated "Destination connection" in either direction, whatever closure is in force.
 */
const snap = (call: any, point: object, now: number) =>
  call({ op: "mapPoint", point, proposed: false, now }).point;
const statusAt = (init: any, id: string) =>
  init.updates.find((u: any) => u.id === id)?.status as string;

// ---- Willow: the real leg, clipped inside it --------------------------------------------------------------------

const willow = () => network(feature("54:1305", [V97, V98]));

test(
  "Willow: before it starts the whole leg is one route that can start, with a notice that says Scheduled",
  { skip },
  async () => {
    const { call } = await engine(willow());
    const before = plan(call, V97, V98, WILLOW_START - 1);
    assert.equal(before.canNavigate, true);
    assert.deepEqual(before.closures, []);
    const notice = before.warnings.find((w: string) =>
      /Scheduled Willow Street trail closure/.test(w),
    );
    assert.ok(notice, "the scheduled notice is shown");
    assert.match(notice, /Scheduled, not closed yet/);
    assert.doesNotMatch(notice, /closed since/);
    // The route is the original leg, unclipped.
    const points = before.route.segments.flatMap((s: any) => s.points);
    assert.ok(
      points.some((p: any) => Math.abs(p.latitude - V98.latitude) < 1e-9),
    );
  },
);

test(
  "Willow: at its instant a saved route cannot start, a new plan finds no route, recalculation gives the guidance; one millisecond earlier none of that held",
  { skip },
  async () => {
    const { call } = await engine(willow());
    const saved = plan(call, V97, V98, WILLOW_START - 1).route;
    const justBefore = call({
      op: "inspect",
      route: saved,
      now: WILLOW_START - 1,
    });
    assert.equal(justBefore.canNavigate, true);
    const atStart = call({ op: "inspect", route: saved, now: WILLOW_START });
    assert.equal(atStart.canNavigate, false);
    assert.equal(atStart.closures.length, 1);
    assert.equal(atStart.closures[0].id, WILLOW_ID);
    assert.match(
      atStart.closures[0].sourceUrl,
      /normalil\.gov\/m\/newsflash\/home\/detail\/3356$/,
    );
    assert.match(
      atStart.closures[0].locationDescription,
      /Checked October 2, 2026/,
    );
    // Start itself (the first navigation fix) is refused by the core, with the reason; the same route is accepted before.
    const refused = call({
      op: "snapshot",
      route: saved,
      point: V97,
      accuracy: 5,
      timestamp: WILLOW_START,
      progress: 0,
      now: WILLOW_START,
    });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /This route cannot start navigation/);
    const accepted = call({
      op: "snapshot",
      route: saved,
      point: V97,
      accuracy: 5,
      timestamp: WILLOW_START - 1,
      progress: 0,
      now: WILLOW_START - 1,
    });
    assert.equal(accepted.ok, true);
    // A new plan across the leg, and a recalculation, find no way through; the closure comes back with its labels.
    const fresh = plan(call, V97, V98, WILLOW_START);
    assert.equal(fresh.route, null);
    assert.match(fresh.error, /No safe route avoids the active trail closure/);
    assert.equal(fresh.closures[0].id, WILLOW_ID);
    assert.match(fresh.closures[0].mappingNote, /^Approximate/);
    assert.equal(fresh.closures[0].estimatedEnd, WILLOW_END);
    const again = call({ op: "recalculate", route: saved, now: WILLOW_START });
    assert.equal(again.route, null);
    assert.match(again.error, /No safe route avoids the active trail closure/);
  },
);

test(
  "Willow: both residual portions of the original leg stay usable, and the unchanged source leg is what is drawn",
  { skip },
  async () => {
    const { call, init } = await engine(willow(), WILLOW_START);
    // The loaded line is exactly the two source vertices: nothing was inserted or moved.
    assert.deepEqual(init.features[0].paths, [[V97, V98]]);
    const south = plan(
      call,
      snap(call, V97, WILLOW_START),
      snap(call, FROM, WILLOW_START),
      WILLOW_START,
    );
    const north = plan(
      call,
      snap(call, TO, WILLOW_START),
      snap(call, V98, WILLOW_START),
      WILLOW_START,
    );
    for (const result of [south, north]) {
      assert.equal(result.ok, true);
      assert.ok(result.route);
      assert.equal(result.canNavigate, true);
      assert.deepEqual(result.closures, []);
    }
    // Their lengths are the residual distances: about 388 m and about 200 m of the 790 m leg.
    assert.ok(
      south.distance > 380 && south.distance < 395,
      `${south.distance}`,
    );
    assert.ok(
      north.distance > 195 && north.distance < 205,
      `${north.distance}`,
    );
    // The closure is drawn from the unchanged source line, between the two projected bounds only.
    const drawn = init.closures.find((c: any) => c.id === WILLOW_ID);
    assert.deepEqual(drawn.points, [FROM, TO]);
    assert.equal(drawn.checkedOn, "October 2, 2026");
    assert.match(drawn.mappingNote, /Not surveyed barricade locations/);
  },
);

test(
  "Willow: the closure is not drawn or gated before its instant, and the guide status changes at each instant",
  { skip },
  async () => {
    const early = await engine(willow(), WILLOW_START - 1);
    assert.ok(!early.init.closures.some((c: any) => c.id === WILLOW_ID));
    assert.match(statusAt(early.init, "willow-trail-closure"), /^Scheduled/);
    const at = await engine(willow(), WILLOW_START);
    assert.match(
      statusAt(at.init, "willow-trail-closure"),
      /^Closed since October 5/,
    );
    const late = await engine(willow(), WILLOW_END + 1);
    assert.equal(statusAt(late.init, "willow-trail-closure"), "Recheck needed");
    // The estimate has passed and the closure is still drawn and still gates: nothing reopens by the date alone.
    assert.ok(late.init.closures.some((c: any) => c.id === WILLOW_ID));
  },
);

test(
  "Willow: after the estimated end the saved route still cannot start and says the estimate passed; a new plan still finds no route",
  { skip },
  async () => {
    const { call } = await engine(willow());
    const saved = plan(call, V97, V98, WILLOW_START - 1).route;
    for (const now of [
      WILLOW_END,
      WILLOW_END + 1,
      WILLOW_END + 30 * 86_400_000,
    ]) {
      const result = call({ op: "inspect", route: saved, now });
      assert.equal(result.canNavigate, false, `at ${now}`);
      assert.equal(result.closures[0].id, WILLOW_ID);
    }
    const after = call({ op: "inspect", route: saved, now: WILLOW_END + 1 });
    assert.ok(
      after.warnings.some((w: string) =>
        /has passed; reopening has not been confirmed/.test(w),
      ),
    );
    assert.equal(plan(call, V97, V98, WILLOW_END + 86_400_000).route, null);
  },
);

// ---- Willow: any travel along the section is refused, however short, at either boundary -----------------------------

/** Meters between two nearby points (equirectangular, ample at this scale). */
const distance = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) =>
  Math.hypot(
    (b.latitude - a.latitude) * 111_194.93,
    (b.longitude - a.longitude) *
      Math.cos((a.latitude * Math.PI) / 180) *
      111_194.93,
  );
const LEG_METERS = distance(V97, V98);
const FROM_METERS = distance(V97, FROM);
const TO_METERS = FROM_METERS + distance(FROM, TO);
/** A point `meters` along the unchanged raw leg from vertex 97 toward vertex 98. */
const along = (meters: number) => ({
  latitude:
    V97.latitude + ((V98.latitude - V97.latitude) * meters) / LEG_METERS,
  longitude:
    V97.longitude + ((V98.longitude - V97.longitude) * meters) / LEG_METERS,
});
const refusedAt = (call: any, route: any, point: object, now: number) => {
  const inspected = call({ op: "inspect", route, now });
  const start = call({
    op: "snapshot",
    route,
    point,
    accuracy: 5,
    timestamp: now,
    progress: 0,
    now,
  });
  return { inspected, start };
};

test(
  "Willow: routes wholly inside the section, from 1 m to 150 m and in both directions, are refused at the instant and after the estimate (inspect and Start)",
  { skip },
  async () => {
    const { call } = await engine(willow());
    const first = along(0.6 * LEG_METERS);
    for (const meters of [1, 5, 10, 14, 16, 30, 150]) {
      const other = along(0.6 * LEG_METERS + meters);
      for (const [from, to] of [
        [first, other],
        [other, first],
      ]) {
        const planned = plan(call, from, to, WILLOW_START - 1);
        assert.equal(planned.ok, true, `${meters} m plans`);
        assert.ok(planned.route, `${meters} m has a route`);
        assert.equal(planned.canNavigate, true, `${meters} m is open before`);
        // One millisecond before: open, and Start is accepted.
        const early = refusedAt(call, planned.route, from, WILLOW_START - 1);
        assert.equal(early.inspected.canNavigate, true);
        assert.equal(early.start.ok, true, `${meters} m Start before`);
        for (const now of [WILLOW_START, WILLOW_END + 1]) {
          const { inspected, start } = refusedAt(
            call,
            planned.route,
            from,
            now,
          );
          assert.equal(inspected.canNavigate, false, `${meters} m at ${now}`);
          assert.equal(inspected.closures[0].id, WILLOW_ID);
          assert.equal(start.ok, false, `${meters} m Start at ${now}`);
          assert.match(start.error, /cannot start navigation/);
          // Recalculation offers no way around it either: a start or destination inside the section has no detour, and
          // an estimated hop to the nearest bound and back is not one. Nothing is returned for a front end to apply.
          const again = call({ op: "recalculate", route: planned.route, now });
          assert.equal(
            again.route,
            null,
            `${meters} m recalculation at ${now}`,
          );
          assert.match(
            again.error,
            /No safe route avoids the active trail closure/,
          );
          assert.equal(again.closures[0].id, WILLOW_ID);
        }
      }
    }
  },
);

test(
  "Willow: a few meters across EITHER boundary is refused, while routes that stop at a bound or approach from beyond it stay open",
  { skip },
  async () => {
    const { call } = await engine(willow());
    const refusedRoutes = [
      [FROM_METERS - 4, FROM_METERS + 3],
      [FROM_METERS + 3, FROM_METERS - 4],
      [TO_METERS - 3, TO_METERS + 4],
      [TO_METERS + 4, TO_METERS - 3],
      [FROM_METERS - 25, TO_METERS + 25],
      [TO_METERS + 25, FROM_METERS - 25],
    ];
    for (const [a, b] of refusedRoutes) {
      const planned = plan(call, along(a), along(b), WILLOW_START - 1);
      assert.ok(planned.route, `${a} to ${b} plans`);
      const { inspected, start } = refusedAt(
        call,
        planned.route,
        along(a),
        WILLOW_START,
      );
      assert.equal(inspected.canNavigate, false, `${a} to ${b}`);
      assert.equal(start.ok, false, `${a} to ${b} Start`);
    }
    // Approaches that end exactly at, or short of, a bound are the residual portions, usable and current.
    const openRoutes = [
      [FROM_METERS - 30, FROM_METERS],
      [FROM_METERS, FROM_METERS - 30],
      [TO_METERS, TO_METERS + 30],
      [TO_METERS + 30, TO_METERS],
      [FROM_METERS - 30, FROM_METERS - 0.3],
      [TO_METERS + 0.3, TO_METERS + 30],
    ];
    for (const [a, b] of openRoutes) {
      const planned = plan(call, along(a), along(b), WILLOW_START - 1);
      assert.ok(planned.route, `${a} to ${b} plans`);
      for (const now of [WILLOW_START, WILLOW_END + 1]) {
        const { inspected, start } = refusedAt(
          call,
          planned.route,
          along(a),
          now,
        );
        assert.equal(inspected.canNavigate, true, `${a} to ${b} at ${now}`);
        assert.deepEqual(inspected.closures, []);
        assert.equal(inspected.network.status, "current");
        assert.equal(start.ok, true, `${a} to ${b} Start at ${now}`);
        // A legitimate recalculation of an unaffected route still returns a replacement outside the section.
        const repaired = call({ op: "recalculate", route: planned.route, now });
        assert.ok(repaired.route, `${a} to ${b} recalculates at ${now}`);
        assert.deepEqual(repaired.closures, []);
      }
    }
  },
);

test(
  "Willow: the same holds for the reversed raw path, and a restored saved route is judged the same way after a reload",
  { skip },
  async () => {
    const reversed = network(feature("54:1305", [V98, V97]));
    const { call } = await engine(reversed);
    const a = along(0.6 * LEG_METERS);
    const b = along(0.6 * LEG_METERS + 10);
    const planned = plan(call, a, b, WILLOW_START - 1);
    assert.ok(planned.route);
    assert.equal(
      call({ op: "inspect", route: planned.route, now: WILLOW_START })
        .canNavigate,
      false,
    );
    // A fresh worker (a reload) given the same data and the saved route reaches the same answer, with no state carried.
    const reloaded = await engine(willow(), WILLOW_START);
    const saved = (await engine(willow())).call({
      op: "plan",
      start: a,
      destination: b,
      proposed: false,
      now: WILLOW_START - 1,
    });
    assert.ok(saved.route);
    const restored = reloaded.call({
      op: "inspect",
      route: saved.route,
      now: WILLOW_START,
    });
    assert.equal(restored.canNavigate, false);
    assert.equal(restored.closures[0].id, WILLOW_ID);
    const recalculated = reloaded.call({
      op: "recalculate",
      route: saved.route,
      now: WILLOW_START,
    });
    assert.equal(recalculated.route, null);
    assert.match(
      recalculated.error,
      /No safe route avoids the active trail closure/,
    );
    assert.equal(recalculated.closures[0].id, WILLOW_ID);
  },
);

// The ACTUAL vertices 17 to 23 of county 16:188 (a SharedRoadways feature). It meets the trail 0.4 m from the south bound
// (inside the router's snap distance) and runs east and west across it. County trail data, CC BY 4.0, McLean County GIS.
const CYPRESS = [
  [40.51310035684313, -88.98524723245112],
  [40.513108846844446, -88.98489778315425],
  [40.513112229536965, -88.9846629215164],
  [40.51311225994217, -88.98465752712063],
  [40.513113215957986, -88.98460965908697],
  [40.51312175214399, -88.98425166848882],
  [40.51312759544274, -88.98382329541326],
].map(([latitude, longitude]) => ({ latitude, longitude }));

test(
  "Willow: the actual Cypress crossing geometry stays usable and current in either feature order, in both directions, with no ride along the section",
  { skip },
  async () => {
    const cypress = feature("16:188", CYPRESS, ["SharedRoadways"]);
    for (const features of [
      [feature("54:1305", [V97, V98]), cypress],
      [cypress, feature("54:1305", [V97, V98])],
    ]) {
      const { call } = await engine(network(...features));
      for (const [from, to] of [
        [CYPRESS[0], CYPRESS[6]],
        [CYPRESS[6], CYPRESS[0]],
        [CYPRESS[1], CYPRESS[5]],
      ]) {
        for (const now of [WILLOW_START - 1, WILLOW_START, WILLOW_END + 1]) {
          const crossing = plan(
            call,
            snap(call, from, now),
            snap(call, to, now),
            now,
          );
          // Non-vacuous: a route exists and really uses the crossing feature across the trail.
          assert.equal(crossing.ok, true);
          assert.ok(crossing.route, `a crossing route exists at ${now}`);
          assert.ok(
            crossing.route.edges.some(
              (e: any) => e.sourceFeatureId === "16:188",
            ),
          );
          assert.ok(
            crossing.route.segments
              .flatMap((s: any) => s.points)
              .some(
                (p: any) =>
                  Math.hypot(
                    p.latitude - FROM.latitude,
                    (p.longitude - FROM.longitude) * 0.76,
                  ) < 0.00002,
              ),
            "the route passes the south bound",
          );
          assert.equal(crossing.canNavigate, true);
          assert.deepEqual(crossing.closures, []);
          const inspected = call({ op: "inspect", route: crossing.route, now });
          assert.equal(inspected.canNavigate, true, `crossing at ${now}`);
          assert.equal(inspected.network.status, "current");
        }
      }
      // And a residual approach that stops short of the bound, alongside the crossing.
      const approach = plan(
        call,
        snap(call, V97, WILLOW_START),
        snap(call, along(FROM_METERS - 5), WILLOW_START),
        WILLOW_START,
      );
      assert.ok(approach.route, "the southern residual approach exists");
      assert.equal(approach.canNavigate, true);
      assert.deepEqual(approach.closures, []);
    }
  },
);

// ---- Camelback: a known closed crossing; no cut, no invented limits, and no Start across it ---------------------------

const CROSSING = { latitude: 40.4982689784, longitude: -88.983416249 };
const V6 = { latitude: 40.4979744336, longitude: -88.9833910595 };
const V7 = { latitude: 40.4982765696, longitude: -88.9834168982 };
const V8 = { latitude: 40.4983674522, longitude: -88.9834245174 };
// Trail ends a short way beyond the actual vertices, so a route has room to snap on both sides of the crossing.
const SOUTH_END = {
  latitude: V6.latitude - 0.0015,
  longitude: V6.longitude + 0.00002,
};
const NORTH_END = {
  latitude: V8.latitude + 0.0015,
  longitude: V8.longitude - 0.00002,
};
// The ACTUAL affected feature id (54:1305), with the actual vertices 6, 7 and 8 around the crossing.
const camelbackTrail = () =>
  feature("54:1305", [SOUTH_END, V6, V7, V8, NORTH_END]);
const camelback = () => network(camelbackTrail());

test(
  "Camelback: before 8 a.m. the notice says Scheduled and Start works; from the instant, in both directions and after the estimate, inspect, Start and recalculation refuse, and the preview still exists",
  { skip },
  async () => {
    const { call } = await engine(camelback());
    for (const [from, to] of [
      [SOUTH_END, NORTH_END],
      [NORTH_END, SOUTH_END],
    ]) {
      const early = plan(call, from, to, CAMEL_START - 1);
      assert.equal(early.ok, true);
      assert.ok(early.route);
      assert.equal(early.canNavigate, true);
      const scheduled = early.warnings.find((w: string) =>
        /Scheduled, not closed yet/.test(w),
      );
      assert.ok(scheduled);
      // Before the instant nothing is refused yet: it says what WILL happen, not that it is happening.
      assert.doesNotMatch(scheduled, /does not start this route/);
      assert.doesNotMatch(scheduled, /can still be started/);
      assert.match(
        scheduled,
        /this closure does not stop Trail Mapper from starting a route \(other closures and checks may\)/,
      );
      assert.match(scheduled, /will not start a route that crosses there/);
      assert.equal(
        refusedAt(call, early.route, from, CAMEL_START - 1).start.ok,
        true,
      );
      for (const now of [
        CAMEL_START,
        CAMEL_START + 1,
        CAMEL_END,
        CAMEL_END + 1,
        CAMEL_END + 30 * 86_400_000,
      ]) {
        const { inspected, start } = refusedAt(call, early.route, from, now);
        assert.equal(inspected.canNavigate, false, `inspect at ${now}`);
        assert.equal(inspected.closures[0].id, CAMEL_ID);
        assert.equal(inspected.network.status, "current");
        assert.equal(start.ok, false, `Start at ${now}`);
        assert.match(start.error, /cannot start navigation/);
        // The preview is still planned (nothing is cut), but it is marked as blocked, with the honest limitation.
        const preview = plan(call, from, to, now);
        assert.ok(preview.route, `preview at ${now}`);
        assert.equal(preview.canNavigate, false);
        assert.equal(preview.closures[0].id, CAMEL_ID);
        assert.match(preview.closures[0].message, /cannot plan around it/);
        assert.match(
          preview.closures[0].message,
          /no closure limits along\s+the trail|no trail detour and no closure limits/,
        );
        const again = call({ op: "recalculate", route: early.route, now });
        assert.equal(again.canNavigate, false);
        assert.equal(again.route, null);
      }
      const note = (now: number) =>
        call({ op: "inspect", route: early.route, now }).warnings.find(
          (w: string) => /Camelback/.test(w),
        );
      assert.match(
        note(CAMEL_START),
        /closed Constitution Trail from 8 a\.m\. CDT/,
      );
      assert.match(note(CAMEL_START), /does not start this route/);
      assert.match(
        note(CAMEL_END + 1),
        /has passed; reopening has not been confirmed/,
      );
    }
  },
);

test(
  "Camelback: nothing is cut, and a route that stops short of the crossing, starts beyond it, uses the road across it or a neighboring trail is not blocked",
  { skip },
  async () => {
    const road = feature(
      "16:297",
      [
        { latitude: V7.latitude - 0.00005, longitude: V7.longitude - 0.002 },
        { latitude: V7.latitude, longitude: V7.longitude - 0.0005 },
        { latitude: V7.latitude + 0.00005, longitude: V7.longitude + 0.002 },
      ],
      ["SharedRoadways"],
    );
    const neighbor = feature("54:68", [
      { latitude: 40.499, longitude: -88.99 },
      { latitude: 40.5, longitude: -88.99 },
    ]);
    const { call, init } = await engine(
      network(camelbackTrail(), road, neighbor),
      CAMEL_START,
    );
    // No interval is invented: the actual feature loads exactly as given and the closure draws nothing.
    assert.deepEqual(init.features.find((f: any) => f.id === "54:1305").paths, [
      [SOUTH_END, V6, V7, V8, NORTH_END],
    ]);
    const crossing = init.closures.find((c: any) => c.id === CAMEL_ID);
    assert.deepEqual(crossing.points, []);
    assert.equal(crossing.crossing, true);
    for (const [from, to] of [
      [SOUTH_END, V6],
      [V8, NORTH_END],
      [road.paths[0][0], road.paths[0][2]].map(([lon, lat]: number[]) => ({
        latitude: lat,
        longitude: lon,
      })),
      [neighbor.paths[0][0], neighbor.paths[0][1]].map(
        ([lon, lat]: number[]) => ({ latitude: lat, longitude: lon }),
      ),
    ] as [any, any][]) {
      for (const now of [CAMEL_START - 1, CAMEL_START, CAMEL_END + 1]) {
        const result = plan(call, from, to, now);
        assert.ok(result.route, `an unaffected route exists at ${now}`);
        assert.equal(result.canNavigate, true, `unaffected at ${now}`);
        assert.deepEqual(result.closures, []);
      }
    }
  },
);

test(
  "Camelback and Willow: a loop through the crossing is refused in both directions with its reversal, from the instant and after the estimate",
  { skip },
  async () => {
    const SOUTH_CORNER = {
      latitude: V6.latitude - 0.003,
      longitude: V6.longitude + 0.00002,
    };
    const NORTH_CORNER = {
      latitude: V8.latitude + 0.003,
      longitude: V8.longitude - 0.00002,
    };
    const east = (p: { latitude: number; longitude: number }) => ({
      ...p,
      longitude: p.longitude + 0.004,
    });
    const ring = network(
      feature("54:1305", [SOUTH_CORNER, V6, V7, V8, NORTH_CORNER]),
      feature("54:9300", [
        NORTH_CORNER,
        east(NORTH_CORNER),
        east(SOUTH_CORNER),
        SOUTH_CORNER,
      ]),
    );
    const { call } = await engine(ring);
    const loop = call({
      op: "plan",
      start: SOUTH_CORNER,
      miles: 1.0,
      proposed: false,
      now: CAMEL_START - 1,
    });
    assert.equal(loop.ok, true);
    assert.ok(loop.route, "a loop exists before");
    assert.equal(loop.canNavigate, true);
    assert.ok(
      loop.route.edges.some((e: any) => e.sourceFeatureId === "54:1305"),
    );
    assert.equal(
      call({ op: "reverse", route: loop.route, now: CAMEL_START - 1 })
        .canNavigate,
      true,
    );
    for (const now of [CAMEL_START, CAMEL_END + 1]) {
      assert.equal(
        call({ op: "inspect", route: loop.route, now }).canNavigate,
        false,
        `loop at ${now}`,
      );
      const reversed = call({ op: "reverse", route: loop.route, now });
      assert.equal(reversed.canNavigate, false, `reversal at ${now}`);
      assert.equal(reversed.closures[0].id, CAMEL_ID);
    }
  },
);

test(
  "Both closures in force together: each gates only its own route at its own instant, and an estimate reopens neither",
  { skip },
  async () => {
    const both = network({
      ...feature("54:1305", [V97, V98]),
      paths: [
        [V97, V98].map(lonLat),
        [SOUTH_END, V6, V7, V8, NORTH_END].map(lonLat),
      ],
    });
    const { call, init } = await engine(both, CAMEL_START);
    assert.ok(init.closures.some((c: any) => c.id === WILLOW_ID));
    assert.ok(init.closures.some((c: any) => c.id === CAMEL_ID));
    const savedWillow = plan(call, V97, V98, WILLOW_START - 1).route;
    const savedCamel = plan(call, SOUTH_END, NORTH_END, CAMEL_START - 1).route;
    assert.ok(savedWillow && savedCamel);
    const verdicts = (now: number) => ({
      willow: call({ op: "inspect", route: savedWillow, now }),
      camel: call({ op: "inspect", route: savedCamel, now }),
    });
    // Between the two instants only Willow is in force.
    const between = verdicts(WILLOW_START);
    assert.equal(between.willow.canNavigate, false);
    assert.equal(between.willow.closures[0].id, WILLOW_ID);
    assert.equal(between.camel.canNavigate, true);
    for (const now of [CAMEL_START, CAMEL_END + 1, WILLOW_END + 1]) {
      const both = verdicts(now);
      assert.equal(both.willow.canNavigate, false, `Willow at ${now}`);
      assert.equal(both.willow.closures[0].id, WILLOW_ID);
      if (now >= CAMEL_START) {
        assert.equal(both.camel.canNavigate, false, `Camelback at ${now}`);
        assert.equal(both.camel.closures[0].id, CAMEL_ID);
      }
    }
  },
);

test(
  "Moved source geometry makes a saved route stale before any closure, so a closure never rescues or hides a route on changed data",
  { skip },
  async () => {
    const original = await engine(willow());
    const saved = plan(original.call, V97, V98, WILLOW_START - 86_400_000);
    assert.ok(saved.route);
    assert.equal(saved.network.status, "current");
    // The same trail with its far vertex moved about 11 m east: the saved route no longer matches the data.
    const moved = await engine(
      network(
        feature("54:1305", [
          V97,
          { ...V98, longitude: V98.longitude + 0.00012 },
        ]),
      ),
    );
    for (const now of [
      WILLOW_START - 86_400_000,
      WILLOW_START,
      WILLOW_END + 1,
    ]) {
      const inspected = moved.call({ op: "inspect", route: saved.route, now });
      assert.notEqual(inspected.network.status, "current", `stale at ${now}`);
      assert.equal(inspected.canNavigate, false, `not startable at ${now}`);
    }
    // Camelback likewise: a route saved on the actual crossing geometry is stale once that geometry moves.
    const camelOriginal = await engine(camelback());
    const savedCamel = plan(
      camelOriginal.call,
      SOUTH_END,
      NORTH_END,
      CAMEL_START - 86_400_000,
    );
    assert.ok(savedCamel.route);
    const movedCamel = await engine(
      network(
        feature("54:1305", [
          SOUTH_END,
          V6,
          { ...V7, longitude: V7.longitude + 0.00012 },
          V8,
          NORTH_END,
        ]),
      ),
    );
    for (const now of [CAMEL_START - 86_400_000, CAMEL_START, CAMEL_END + 1]) {
      const inspected = movedCamel.call({
        op: "inspect",
        route: savedCamel.route,
        now,
      });
      assert.notEqual(
        inspected.network.status,
        "current",
        `Camelback stale at ${now}`,
      );
      assert.equal(inspected.canNavigate, false);
    }
  },
);

// ---- The other notices -------------------------------------------------------------------------------------------

test(
  "Raab paving and the older Collegiate estimate are guide notices only: scheduled, then under way, then recheck; never a barrier",
  { skip },
  async () => {
    const { init } = await engine(willow(), RAAB_START - 1);
    assert.match(statusAt(init, "trail-paving-raab"), /^Scheduled/);
    const raab = init.updates.find((u: any) => u.id === "trail-paving-raab");
    assert.match(raab.details, /does not say which trail sections close/);
    assert.match(
      raab.details,
      /does not mark a trail barrier|not mark a trail barrier/,
    );
    assert.match(
      raab.source.url,
      /normalil\.gov\/m\/newsflash\/Home\/Detail\/3357$/,
    );
    const on = await engine(willow(), RAAB_START);
    assert.match(statusAt(on.init, "trail-paving-raab"), /^Paving under way/);
    const old = on.init.updates.find(
      (u: any) => u.id === "collegiate-repaving",
    );
    assert.match(old.details, /estimated the closures would end by October 2/);
    assert.match(old.details, /No confirmed completion was found/);
    assert.doesNotMatch(old.details, /has passed/);
    assert.equal(statusAt(on.init, "collegiate-repaving"), "Recheck needed");
    // No closure for it exists: only the Uptown and Willow closures can be in force.
    assert.ok(
      on.init.closures.every((c: any) => !/raab|paving|collegiate/i.test(c.id)),
    );
  },
);

test(
  "Hamilton stays an informational notice using the official map estimate, before and after it, and never blocks",
  { skip },
  async () => {
    const access = {
      layers: [
        {
          id: "tiger",
          features: [
            {
              id: "8:2368212",
              name: "E Hamilton Rd",
              mtfcc: "S1400",
              paths: [
                [
                  [-88.98, 40.4513],
                  [-88.975, 40.4513],
                ],
              ],
            },
          ],
        },
      ],
    };
    const trail = network(
      feature("54:9200", [
        { latitude: 40.4513, longitude: -88.975 },
        { latitude: 40.4533, longitude: -88.975 },
      ]),
    );
    const module: any = await import(
      `${pathToFileURL(corePath).href}?timed=${++instances}`
    );
    const call = (request: unknown) =>
      JSON.parse(module.dispatch(JSON.stringify(request)));
    call({
      op: "initialize",
      trails: JSON.stringify(trail),
      access: JSON.stringify(access),
      now: HAMILTON_END,
    });
    const onRoad = { latitude: 40.4513, longitude: -88.98 };
    const trailEnd = { latitude: 40.4533, longitude: -88.975 };
    for (const [now, pattern] of [
      [HAMILTON_END - 1, /an estimate does not confirm reopening/],
      [HAMILTON_END + 1, /has passed; reopening has not been confirmed/],
    ] as [number, RegExp][]) {
      const result = call({
        op: "plan",
        start: onRoad,
        destination: trailEnd,
        proposed: false,
        now,
      });
      assert.equal(result.canNavigate, true);
      assert.deepEqual(result.closures, []);
      const warning = result.warnings.find((w: string) => /Hamilton/.test(w));
      assert.match(warning, pattern);
      assert.match(warning, /object 841/);
    }
  },
);

// ---- the UNCHANGED actual path, when the private native asset is present ------------------------------------------

const assetFile = join(
  resolve(process.cwd(), ".."),
  "data",
  "generated",
  "mcgis-trails.normalized.json",
);
const noAsset = existsSync(assetFile)
  ? false
  : "the private native asset data/generated/mcgis-trails.normalized.json is not present (the sharedLogic TimedClosureRealDataTest needs it too; every other test in this file runs without it)";

/** The actual native network in four orders: feature order and the raw path's direction, each both ways. */
function assetVariants(text: string): [string, string][] {
  const raw = JSON.parse(text);
  const make = (reverseFeatures: boolean, reverseRaw: boolean) => {
    const copy = JSON.parse(text);
    for (const layer of copy.layers) {
      if (reverseRaw)
        for (const f of layer.features)
          if (f.id === "54:1305")
            f.paths = f.paths.map((p: any[]) => [...p].reverse());
      if (reverseFeatures) layer.features.reverse();
    }
    if (reverseFeatures) copy.layers.reverse();
    return JSON.stringify(copy);
  };
  void raw;
  return [
    ["asset order", text],
    ["reversed feature order", make(true, false)],
    ["reversed raw path", make(false, true)],
    ["reversed raw path and feature order", make(true, true)],
  ];
}

test(
  "On the actual 54:1305 path: raw leg unchanged, both closures active, short routes and boundary penetration refused, residuals, Cypress, northern junction and Camelback, in every order",
  { skip: skip || noAsset },
  async () => {
    const text = readFileSync(assetFile, "utf8");
    const raw = JSON.parse(text);
    const all = raw.layers.flatMap((l: any) => l.features);
    const real = all.find((f: any) => f.id === "54:1305").paths[0];
    assert.equal(real.length, 99);
    // The brief records these vertices to ten decimals; the asset carries more digits.
    for (const [index, vertex] of [
      [97, V97],
      [98, V98],
    ] as const) {
      assert.ok(Math.abs(real[index][0] - vertex.longitude) < 1e-9);
      assert.ok(Math.abs(real[index][1] - vertex.latitude) < 1e-9);
    }
    const pt = (p: number[]) => ({ latitude: p[1], longitude: p[0] });
    const refused: Record<string, number> = {};
    for (const [name, variant] of assetVariants(text)) {
      const { call, init } = await engine(variant, WILLOW_START);
      // The loaded line is exactly the source line, whatever the closures cut at plan time; both are in force.
      const loaded = init.features.find((f: any) => f.id === "54:1305");
      const source = JSON.parse(variant)
        .layers.flatMap((l: any) => l.features)
        .find((f: any) => f.id === "54:1305").paths;
      assert.deepEqual(
        loaded.paths,
        source.map((p: number[][]) =>
          p.map(([longitude, latitude]) => ({ latitude, longitude })),
        ),
        name,
      );
      assert.deepEqual(
        init.closures.find((c: any) => c.id === WILLOW_ID).points.length,
        2,
      );
      assert.ok(
        init.closures.some(
          (c: any) => c.id === "uptown-underpass-detour-2026-09-21",
        ),
      );
      // Both residual portions of the original leg route and stay open.
      for (const [from, to] of [
        [V97, FROM],
        [TO, V98],
      ] as const) {
        const result = plan(
          call,
          snap(call, from, WILLOW_START),
          snap(call, to, WILLOW_START),
          WILLOW_START,
        );
        assert.ok(result.route, `${name} residual route exists`);
        assert.equal(result.canNavigate, true, name);
        assert.deepEqual(result.closures, []);
      }
      // Routes planned a day earlier along the leg, then judged at the instant and after the estimate (inspect and Start).
      refused[name] = 0;
      const first = along(0.6 * LEG_METERS);
      for (const meters of [5, 10, 14, 16, 30, 150]) {
        const other = along(0.6 * LEG_METERS + meters);
        for (const [a, b] of [
          [first, other],
          [other, first],
        ]) {
          const planned = plan(call, a, b, WILLOW_START - 1);
          assert.ok(planned.route, `${name} ${meters} m plans`);
          const estimated = planned.accessGaps.length > 0;
          for (const now of [WILLOW_START, WILLOW_END + 1]) {
            const { inspected, start } = refusedAt(call, planned.route, a, now);
            // Refused either by the closure gate or by the separate estimated-gap rule; never startable.
            assert.equal(
              inspected.canNavigate,
              false,
              `${name} ${meters} m at ${now}`,
            );
            assert.equal(
              start.ok,
              false,
              `${name} ${meters} m Start at ${now}`,
            );
            if (!estimated)
              assert.equal(
                inspected.closures[0].id,
                WILLOW_ID,
                `${name} ${meters} m`,
              );
          }
          if (!estimated) refused[name]++;
        }
      }
      // The Cypress crossing (actual geometry and roles), the northern junction and Hidden Creek stay usable.
      for (const [id, pathIndex, i, j] of [
        ["16:188", 0, 17, 23],
        ["54:4349", 0, 2, 5],
        ["54:2578", 2, 10, 14],
        ["16:1348", 0, 2, 5],
      ] as const) {
        const path = all.find((f: any) => f.id === id).paths[pathIndex];
        const result = plan(
          call,
          snap(call, pt(path[i]), WILLOW_START),
          snap(call, pt(path[j]), WILLOW_START),
          WILLOW_START,
        );
        assert.ok(result.route, `${name} a route on ${id} exists`);
        assert.equal(result.canNavigate, true, `${name} ${id}`);
        assert.deepEqual(result.closures, []);
      }
      // Camelback on the actual vertices 6 to 8: preview exists; open before, refused from the instant and after the estimate.
      for (const [rawA, rawB] of [
        [pt(real[6]), pt(real[8])],
        [pt(real[8]), pt(real[6])],
        [pt(real[3]), pt(real[12])],
      ]) {
        // Planned the way a rider does: from points the map picker returns (projected onto the loaded trail).
        const a = snap(call, rawA, CAMEL_START - 1);
        const b = snap(call, rawB, CAMEL_START - 1);
        const earlier = plan(call, a, b, CAMEL_START - 1);
        assert.ok(earlier.route, `${name} Camelback route exists`);
        assert.equal(
          earlier.canNavigate,
          true,
          `${name} Camelback open before`,
        );
        assert.equal(
          refusedAt(call, earlier.route, a, CAMEL_START - 1).start.ok,
          true,
        );
        for (const now of [CAMEL_START, CAMEL_END + 1]) {
          const { inspected, start } = refusedAt(call, earlier.route, a, now);
          assert.equal(
            inspected.canNavigate,
            false,
            `${name} Camelback at ${now}`,
          );
          assert.equal(inspected.closures[0].id, CAMEL_ID);
          assert.equal(start.ok, false);
          assert.ok(plan(call, a, b, now).route, "the preview still exists");
        }
      }
      // Not crossing it: short of it and beyond it.
      for (const [a, b] of [
        [pt(real[0]), pt(real[5])],
        [pt(real[9]), pt(real[14])],
      ]) {
        const result = plan(
          call,
          snap(call, a, CAMEL_START),
          snap(call, b, CAMEL_START),
          CAMEL_START,
        );
        assert.ok(result.route, `${name} unaffected route exists`);
        assert.equal(result.canNavigate, true, `${name} unaffected`);
      }
    }
    // Not vacuous: where the planner routes on the trail the gate itself refused most of them.
    assert.ok(
      refused["asset order"] >= 10,
      `asset order: ${refused["asset order"]}`,
    );
    assert.ok(
      refused["reversed raw path"] >= 10,
      `reversed raw: ${refused["reversed raw path"]}`,
    );
  },
);

// ---- Map-picker routes on a node-anchored chord, a mapped road detour, and simultaneous notices -------------------------

/** Meters a point lies from the unchanged raw leg 97 -> 98's line (planar, local). */
const offRawLeg = (p: { latitude: number; longitude: number }) => {
  const k = 111_194.93;
  const cos = Math.cos((V97.latitude * Math.PI) / 180);
  const x = (q: { latitude: number; longitude: number }) =>
    (q.longitude - V97.longitude) * cos * k;
  const y = (q: { latitude: number; longitude: number }) =>
    (q.latitude - V97.latitude) * k;
  const length = Math.hypot(x(V98), y(V98));
  return Math.abs((x(p) * y(V98) - y(p) * x(V98)) / length);
};
const routePoints = (route: any) =>
  route.segments.flatMap((s: any) => s.points) as {
    latitude: number;
    longitude: number;
  }[];
const eastOf = (
  p: { latitude: number; longitude: number },
  meters: number,
) => ({
  latitude: p.latitude,
  longitude:
    p.longitude +
    meters / (111_194.93 * Math.cos((p.latitude * Math.PI) / 180)),
});
/** The Start check the app makes while riding: a fresh snapshot at the instant, resuming the saved route. */
const startAt = (call: any, route: any, point: object, now: number) =>
  call({
    op: "snapshot",
    route,
    point,
    accuracy: 5,
    timestamp: now,
    progress: 0,
    resume: true,
    now,
  });

test(
  "Willow: map-picker routes that follow a node-anchored chord of the source leg (a spur listed first owns vertex 98's node) are refused by inspect and Start, in both directions and both feature orders",
  { skip },
  async () => {
    const spur = feature("54:9100", [eastOf(V98, 4), eastOf(V98, 60)]);
    const leg = feature("54:1305", [V97, V98]);
    let derived = 0;
    for (const features of [
      [spur, leg],
      [leg, spur],
    ]) {
      const { call } = await engine(network(...features));
      const first = snap(call, along(0.6 * LEG_METERS), WILLOW_START - 1);
      for (const meters of [1, 5, 10, 14, 30]) {
        const other = snap(
          call,
          along(0.6 * LEG_METERS + meters),
          WILLOW_START - 1,
        );
        for (const [from, to] of [
          [first, other],
          [other, first],
        ]) {
          const planned = plan(call, from, to, WILLOW_START - 1);
          // A positive control first: current, zero estimated gap, on the source feature, Start-eligible before.
          assert.ok(planned.route, `${meters} m route exists`);
          assert.equal(planned.accessGaps.length, 0);
          assert.ok(
            planned.route.edges.every(
              (e: any) => e.sourceFeatureId === "54:1305",
            ),
          );
          assert.equal(planned.canNavigate, true);
          assert.equal(
            startAt(call, planned.route, from, WILLOW_START - 1).ok,
            true,
          );
          if (routePoints(planned.route).some((p) => offRawLeg(p) > 0.5))
            derived++;
          for (const now of [WILLOW_START, WILLOW_END + 1]) {
            const inspected = call({
              op: "inspect",
              route: planned.route,
              now,
            });
            assert.equal(inspected.canNavigate, false, `${meters} m at ${now}`);
            assert.equal(inspected.closures[0].id, WILLOW_ID);
            assert.equal(startAt(call, planned.route, from, now).ok, false);
          }
          const again = call({
            op: "recalculate",
            route: planned.route,
            now: WILLOW_START,
          });
          assert.equal(again.canNavigate, false);
          assert.equal(again.route, null);
        }
      }
    }
    assert.ok(derived >= 10, `only ${derived} routes followed a derived chord`);
  },
);

test(
  "Willow: a different feature running beside the section, the spur and the residual approaches stay open next to the derived chord",
  { skip },
  async () => {
    const spur = feature("54:9100", [eastOf(V98, 4), eastOf(V98, 60)]);
    const parallel = feature("54:9200", [
      eastOf(along(300), 4),
      eastOf(along(700), 4),
    ]);
    const { call } = await engine(
      network(spur, feature("54:1305", [V97, V98]), parallel),
    );
    const open = (from: object, to: object, id: string) => {
      const planned = plan(
        call,
        snap(call, from, WILLOW_START - 1),
        snap(call, to, WILLOW_START - 1),
        WILLOW_START - 1,
      );
      assert.ok(planned.route);
      assert.equal(planned.accessGaps.length, 0);
      assert.ok(
        planned.route.edges.every((e: any) => e.sourceFeatureId === id),
      );
      const inspected = call({
        op: "inspect",
        route: planned.route,
        now: WILLOW_START,
      });
      assert.equal(inspected.canNavigate, true, "not gated");
      assert.deepEqual(inspected.closures, []);
    };
    open(along(30), along(300), "54:1305");
    open(along(650), along(LEG_METERS - 3), "54:1305");
    open(eastOf(V98, 10), eastOf(V98, 50), "54:9100");
    open(eastOf(along(420), 4), eastOf(along(560), 4), "54:9200");
  },
);

test(
  "Camelback: a route whose chord passes the crossing off the raw line (a spur listed first owns vertex 7's node) is refused by inspect and Start",
  { skip },
  async () => {
    const spur = feature("54:9100", [eastOf(V7, 4), eastOf(V7, 60)]);
    let off = 0;
    for (const features of [
      [spur, camelbackTrail()],
      [camelbackTrail(), spur],
    ]) {
      const { call } = await engine(network(...features), CAMEL_START - 1);
      const beside = (meters: number) => ({
        latitude: CROSSING.latitude + meters / 111_194.93,
        longitude: CROSSING.longitude,
      });
      const south = snap(call, beside(-15), CAMEL_START - 1);
      const north = snap(
        call,
        { latitude: V8.latitude + 0.0005, longitude: V8.longitude },
        CAMEL_START - 1,
      );
      for (const [from, to] of [
        [south, north],
        [north, south],
      ]) {
        const planned = plan(call, from, to, CAMEL_START - 1);
        assert.ok(planned.route);
        assert.equal(planned.accessGaps.length, 0);
        assert.equal(planned.canNavigate, true);
        const pts = routePoints(planned.route);
        let nearest = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) {
          const k = 111_194.93;
          const cos = Math.cos((CROSSING.latitude * Math.PI) / 180);
          const ax = (pts[i].longitude - CROSSING.longitude) * cos * k;
          const ay = (pts[i].latitude - CROSSING.latitude) * k;
          const bx = (pts[i + 1].longitude - CROSSING.longitude) * cos * k;
          const by = (pts[i + 1].latitude - CROSSING.latitude) * k;
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.max(
            0,
            Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
          );
          nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
        }
        if (nearest > 3) off++;
        for (const now of [CAMEL_START, CAMEL_END + 1]) {
          assert.equal(
            call({ op: "inspect", route: planned.route, now }).canNavigate,
            false,
            `inspect at ${now}`,
          );
          assert.equal(startAt(call, planned.route, from, now).ok, false);
        }
      }
    }
    assert.ok(
      off >= 2,
      `only ${off} routes passed the crossing off the raw line`,
    );
  },
);

test(
  "Willow recalculation: a mapped open-road detour is eligible with or without a retained collinear vertex, while the estimated-hop escape from inside the section stays refused",
  { skip },
  async () => {
    const mid = {
      latitude: (FROM.latitude + TO.latitude) / 2,
      longitude: (FROM.longitude + TO.longitude) / 2,
    };
    const west = (p: { latitude: number; longitude: number }) => eastOf(p, -51);
    const east = (p: { latitude: number; longitude: number }) => eastOf(p, 51);
    const sparse = [FROM, west(FROM), west(mid), east(mid), east(TO), TO, V98];
    const dense = [
      FROM,
      west(FROM),
      west(mid),
      mid,
      east(mid),
      east(TO),
      TO,
      V98,
    ];
    for (const [label, path] of [
      ["sparse", sparse],
      ["dense", dense],
    ] as const) {
      const access = {
        layers: [
          {
            id: "tiger",
            features: [
              {
                id: "8:detour",
                name: "Detour St",
                mtfcc: "S1400",
                paths: [path.map(lonLat)],
              },
            ],
          },
        ],
      };
      const module: any = await import(
        `${pathToFileURL(corePath).href}?timed=${++instances}`
      );
      const call = (request: unknown) =>
        JSON.parse(module.dispatch(JSON.stringify(request)));
      assert.equal(
        call({
          op: "initialize",
          trails: JSON.stringify(willow()),
          access: JSON.stringify(access),
          now: WILLOW_START - 86_400_000,
        }).ok,
        true,
      );
      const saved = plan(call, V97, V98, WILLOW_START - 1);
      assert.ok(saved.route, `${label} route exists`);
      assert.equal(saved.canNavigate, true);
      // Positive control first: at the instant a fresh plan is current, ungated, with ZERO unrouted segments.
      const fresh = plan(call, V97, V98, WILLOW_START);
      assert.ok(fresh.route, `${label} fresh plan`);
      assert.equal(fresh.canNavigate, true, `${label} fresh plan can start`);
      assert.deepEqual(fresh.closures, []);
      assert.equal(
        fresh.route.segments.filter((s: any) => s.isRouted === false).length,
        0,
      );
      assert.ok(
        fresh.route.segments.some(
          (s: any) => s.type === "Access" && s.isRouted !== false,
        ),
        `${label} uses the mapped road`,
      );
      const outcome = call({
        op: "recalculate",
        route: saved.route,
        now: WILLOW_START,
      });
      assert.ok(
        outcome.route,
        `${label} recalculation offers the eligible detour (${outcome.error})`,
      );
      assert.equal(outcome.canNavigate, true);
      assert.deepEqual(outcome.closures, []);
      // The original escape stays refused: a route inside the section has only an estimated hop out.
      const inside = plan(
        call,
        snap(call, along(0.6 * LEG_METERS), WILLOW_START - 1),
        snap(call, along(0.6 * LEG_METERS + 10), WILLOW_START - 1),
        WILLOW_START - 1,
      );
      assert.ok(inside.route);
      const refused = call({
        op: "recalculate",
        route: inside.route,
        now: WILLOW_START,
      });
      assert.equal(refused.route, null);
      assert.match(
        refused.error,
        /No safe route avoids the active trail closure/,
      );
    }
  },
);

test(
  "A route refused by Uptown and Willow does not carry a scheduled Camelback sentence that promises Start",
  { skip: skip || noAsset },
  async () => {
    const text = readFileSync(assetFile, "utf8");
    const raw = JSON.parse(text);
    const real = raw.layers
      .flatMap((l: any) => l.features)
      .find((f: any) => f.id === "54:1305").paths[0];
    const pt = (p: number[]) => ({ latitude: p[1], longitude: p[0] });
    const UPTOWN_START = Date.parse("2026-09-21T05:00:00Z");
    const { call } = await engine(text, UPTOWN_START - 1);
    const a = snap(call, pt(real[6]), UPTOWN_START - 1);
    const b = snap(call, pt(real[98]), UPTOWN_START - 1);
    const planned = plan(call, a, b, UPTOWN_START - 1);
    assert.ok(
      planned.route,
      "the actual 6 -> 98 route exists before the notices",
    );
    assert.equal(planned.canNavigate, true);
    const between = WILLOW_START + 3_600_000; // October 5, 12:00Z: Camelback is still scheduled
    const inspected = call({
      op: "inspect",
      route: planned.route,
      now: between,
    });
    assert.equal(inspected.canNavigate, false);
    const ids = inspected.closures.map((c: any) => c.id);
    assert.ok(
      ids.includes(WILLOW_ID) &&
        ids.includes("uptown-underpass-detour-2026-09-21"),
      ids.join(),
    );
    const note = inspected.warnings.find((w: string) =>
      /Scheduled, not closed yet.*Virginia Avenue/.test(w),
    );
    assert.ok(note, "the scheduled Camelback notice is shown");
    assert.doesNotMatch(note, /can still be started/);
    assert.match(
      note,
      /this closure does not stop Trail Mapper from starting a route \(other closures and checks may\)/,
    );
  },
);

test(
  "On the actual 54:1305 path every map-picker route inside the Willow interval is refused by inspect and Start, in every feature order and path direction (1, 5, 10 and 14 m)",
  { skip: skip || noAsset },
  async () => {
    const text = readFileSync(assetFile, "utf8");
    let eligible = 0;
    let derived = 0;
    for (const [name, variant] of assetVariants(text)) {
      const { call } = await engine(variant, WILLOW_START - 1);
      const first = snap(call, along(0.6 * LEG_METERS), WILLOW_START - 1);
      for (const meters of [1, 5, 10, 14]) {
        const other = snap(
          call,
          along(0.6 * LEG_METERS + meters),
          WILLOW_START - 1,
        );
        for (const [from, to] of [
          [first, other],
          [other, first],
        ]) {
          const planned = plan(call, from, to, WILLOW_START - 1);
          assert.ok(planned.route, `${name} ${meters} m route exists`);
          // Positively Start-eligible before the closure: current network, zero estimated gaps, ordinary route.
          assert.equal(
            planned.accessGaps.length,
            0,
            `${name} ${meters} m has no gap`,
          );
          assert.equal(
            planned.canNavigate,
            true,
            `${name} ${meters} m eligible`,
          );
          assert.ok(
            planned.route.edges.every(
              (e: any) => e.sourceFeatureId === "54:1305",
            ),
          );
          eligible++;
          if (routePoints(planned.route).some((p) => offRawLeg(p) > 0.5))
            derived++;
          for (const now of [WILLOW_START, WILLOW_END + 1]) {
            const inspected = call({
              op: "inspect",
              route: planned.route,
              now,
            });
            assert.equal(inspected.network.status, "current");
            assert.equal(
              inspected.canNavigate,
              false,
              `${name} ${meters} m inspect at ${now}`,
            );
            assert.equal(inspected.closures[0].id, WILLOW_ID);
            assert.equal(
              startAt(call, planned.route, from, now).ok,
              false,
              `${name} ${meters} m Start at ${now}`,
            );
          }
        }
      }
    }
    assert.equal(eligible, 32);
    // Not vacuous: some of these really follow a derived chord, a few meters off the raw leg.
    assert.ok(derived >= 8, `only ${derived} routes followed a derived chord`);
  },
);

// ---- Collinear subdivision: the same continuous geometry gets the same decision -------------------------------------

/** The same physical route with every two-point Trail segment (in the route and its edges) split into `points` points. */
const subdivide = (route: any, points: number) => {
  const dense = (segment: any) => {
    if (segment.type !== "Trail" || segment.points.length !== 2) return segment;
    const [a, b] = segment.points;
    return {
      ...segment,
      points: Array.from({ length: points }, (_, i) => ({
        latitude: a.latitude + ((b.latitude - a.latitude) * i) / (points - 1),
        longitude:
          a.longitude + ((b.longitude - a.longitude) * i) / (points - 1),
      })),
    };
  };
  return {
    ...route,
    segments: route.segments.map(dense),
    edges: route.edges.map((e: any) => ({
      ...e,
      routeSegments: e.routeSegments.map(dense),
    })),
  };
};

test(
  "Willow: a dense (collinear subdivided) copy of a saved route on a derived chord is refused exactly like the sparse one, in both directions, after a reload, at 5, 20 and 100 m",
  { skip },
  async () => {
    // The northern node 14 m east of the raw endpoint: the largest displacement the graph allows.
    const spur = feature("54:9100", [eastOf(V98, 14), eastOf(V98, 60)]);
    const leg = feature("54:1305", [V97, V98]);
    let compared = 0;
    for (const features of [
      [spur, leg],
      [leg, spur],
    ]) {
      const { call } = await engine(network(...features));
      const reloaded = await engine(network(...features), WILLOW_START);
      const first = snap(call, along(0.6 * LEG_METERS), WILLOW_START - 1);
      for (const meters of [5, 20, 100]) {
        const other = snap(
          call,
          along(0.6 * LEG_METERS + meters),
          WILLOW_START - 1,
        );
        for (const [from, to] of [
          [first, other],
          [other, first],
        ]) {
          const sparse = plan(call, from, to, WILLOW_START - 1);
          assert.ok(sparse.route);
          assert.equal(sparse.accessGaps.length, 0);
          assert.equal(sparse.canNavigate, true);
          for (const count of [51, 201, 1000]) {
            const dense = subdivide(sparse.route, count);
            assert.ok(
              dense.segments.some((s: any) => s.points.length === count),
              "the dense copy really is denser",
            );
            // Eligible before the closure, sparse and dense.
            assert.equal(
              call({ op: "inspect", route: dense, now: WILLOW_START - 1 })
                .canNavigate,
              true,
            );
            assert.equal(startAt(call, dense, from, WILLOW_START - 1).ok, true);
            for (const now of [WILLOW_START, WILLOW_END + 1]) {
              for (const engineCall of [call, reloaded.call]) {
                for (const route of [sparse.route, dense]) {
                  const inspected = engineCall({ op: "inspect", route, now });
                  assert.equal(
                    inspected.canNavigate,
                    false,
                    `${meters} m, ${route === dense ? count : "sparse"} points at ${now}`,
                  );
                  assert.equal(inspected.closures[0].id, WILLOW_ID);
                  assert.equal(startAt(engineCall, route, from, now).ok, false);
                }
              }
            }
            compared++;
          }
        }
      }
    }
    assert.equal(compared, 36);
  },
);

/** The 14 m spur-first fixture's chord: A to D = eastOf(B, 14), with a position given as a fraction of the raw leg. */
const chordAt = (fraction: number) => {
  const d = eastOf(V98, 14);
  return {
    latitude: V97.latitude + (d.latitude - V97.latitude) * fraction,
    longitude: V97.longitude + (d.longitude - V97.longitude) * fraction,
  };
};
const SOUTH_T = (FROM.latitude - V97.latitude) / (V98.latitude - V97.latitude);
const NORTH_T = (TO.latitude - V97.latitude) / (V98.latitude - V97.latitude);

test(
  "Willow and Camelback: dense copies keep the approach-at-a-bound controls open and the crossing refused",
  { skip },
  async () => {
    const spur = feature("54:9100", [eastOf(V98, 14), eastOf(V98, 60)]);
    const { call } = await engine(
      network(spur, feature("54:1305", [V97, V98])),
    );
    // The bounds carried onto the chord by their fraction of the raw leg (the source geometry fixes the correspondence).
    const at = (fraction: number) =>
      snap(call, chordAt(fraction), WILLOW_START - 1);
    const meters = (m: number) => m / LEG_METERS;
    for (const [a, b] of [
      [SOUTH_T - meters(30), SOUTH_T],
      [SOUTH_T, SOUTH_T - meters(30)],
      [NORTH_T, NORTH_T + meters(30)],
      [NORTH_T + meters(30), NORTH_T],
    ]) {
      const sparse = plan(call, at(a), at(b), WILLOW_START - 1);
      assert.ok(sparse.route, `${a} to ${b}`);
      assert.equal(sparse.accessGaps.length, 0);
      assert.ok(
        routePoints(sparse.route).some((p) => offRawLeg(p) > 0.5),
        "the route rides the chord",
      );
      for (const route of [sparse.route, subdivide(sparse.route, 400)]) {
        const inspected = call({ op: "inspect", route, now: WILLOW_START });
        assert.equal(inspected.canNavigate, true, `${a} to ${b} stays open`);
        assert.deepEqual(inspected.closures, []);
      }
    }
    for (const [a, b] of [
      [SOUTH_T - meters(4), SOUTH_T + meters(3)],
      [NORTH_T + meters(4), NORTH_T - meters(3)],
      [SOUTH_T - meters(20), NORTH_T + meters(20)],
    ]) {
      const sparse = plan(call, at(a), at(b), WILLOW_START - 1);
      assert.ok(sparse.route);
      for (const route of [sparse.route, subdivide(sparse.route, 400)]) {
        assert.equal(
          call({ op: "inspect", route, now: WILLOW_START }).canNavigate,
          false,
          `${a} to ${b} refused`,
        );
      }
    }
    const camel = await engine(
      network(
        feature("54:9100", [eastOf(V7, 14), eastOf(V7, 60)]),
        camelbackTrail(),
      ),
      CAMEL_START - 1,
    );
    const south = snap(
      camel.call,
      {
        latitude: CROSSING.latitude - 15 / 111_194.93,
        longitude: CROSSING.longitude,
      },
      CAMEL_START - 1,
    );
    const north = snap(
      camel.call,
      { latitude: V8.latitude + 0.0005, longitude: V8.longitude },
      CAMEL_START - 1,
    );
    const sparse = plan(camel.call, south, north, CAMEL_START - 1);
    assert.ok(sparse.route);
    for (const route of [sparse.route, subdivide(sparse.route, 300)]) {
      assert.equal(
        camel.call({ op: "inspect", route, now: CAMEL_START }).canNavigate,
        false,
      );
      assert.equal(startAt(camel.call, route, south, CAMEL_START).ok, false);
    }
  },
);

test(
  "Willow: any penetration past the transferred bound on a displaced chord is refused and a route that ends exactly at it is open, both bounds, both directions, sparse, dense and reloaded",
  { skip },
  async () => {
    const spur = feature("54:9100", [eastOf(V98, 14), eastOf(V98, 60)]);
    const trails = network(spur, feature("54:1305", [V97, V98]));
    const { call } = await engine(trails);
    const reloaded = await engine(trails, WILLOW_START);
    const at = (fraction: number) =>
      snap(call, chordAt(fraction), WILLOW_START - 1);
    const meters = (m: number) => m / LEG_METERS;
    let refused = 0;
    for (const into of [0.02, 0.05, 0.1, 0.2, 0.5, 1, 3]) {
      for (const [a, b] of [
        [SOUTH_T - meters(20), SOUTH_T + meters(into)],
        [SOUTH_T + meters(into), SOUTH_T - meters(20)],
        [NORTH_T + meters(20), NORTH_T - meters(into)],
        [NORTH_T - meters(into), NORTH_T + meters(20)],
      ]) {
        const planned = plan(call, at(a), at(b), WILLOW_START - 1);
        // Nonvacuous: current network, zero gaps, Start-eligible before the closure, on the chord.
        assert.ok(planned.route, `${into} m route exists`);
        assert.equal(planned.accessGaps.length, 0);
        assert.equal(planned.canNavigate, true);
        assert.ok(routePoints(planned.route).some((p) => offRawLeg(p) > 0.5));
        for (const route of [planned.route, subdivide(planned.route, 300)]) {
          for (const engineCall of [call, reloaded.call]) {
            const inspected = engineCall({
              op: "inspect",
              route,
              now: WILLOW_START,
            });
            assert.equal(
              inspected.canNavigate,
              false,
              `${into} m past a bound`,
            );
            assert.equal(inspected.closures[0].id, WILLOW_ID);
            assert.equal(
              startAt(engineCall, route, at(a), WILLOW_START).ok,
              false,
            );
          }
        }
        refused++;
      }
    }
    assert.equal(refused, 28);
    // Ending exactly at the transferred bound is not travel.
    for (const [a, b] of [
      [SOUTH_T - meters(30), SOUTH_T],
      [NORTH_T + meters(30), NORTH_T],
    ]) {
      const planned = plan(call, at(a), at(b), WILLOW_START - 1);
      assert.ok(planned.route);
      assert.equal(planned.accessGaps.length, 0);
      for (const route of [planned.route, subdivide(planned.route, 300)]) {
        assert.equal(
          call({ op: "inspect", route, now: WILLOW_START }).canNavigate,
          true,
        );
      }
    }
  },
);

test(
  "Willow: an outside bend inside the geometry tolerance cannot hide exact closed travel at the boundary (straight and bent are both refused, both Start-eligible before)",
  { skip },
  async () => {
    const { call } = await engine(willow());
    const reloaded = await engine(willow(), WILLOW_START);
    const P = (t: number, v: number) => eastOf(along(FROM_METERS + t), v);
    const first = snap(call, P(-21, 0), WILLOW_START - 1);
    const last = snap(call, P(0.1, 0), WILLOW_START - 1);
    const straight = plan(call, first, last, WILLOW_START - 1);
    assert.ok(straight.route);
    assert.equal(straight.accessGaps.length, 0);
    assert.equal(straight.canNavigate, true);
    const bentPoints = [first, P(-1, 0.4), P(0, 0), last];
    const lengthOf = (pts: { latitude: number; longitude: number }[]) => {
      let total = 0;
      for (let i = 0; i + 1 < pts.length; i++)
        total += distance(pts[i], pts[i + 1]);
      return total;
    };
    const scale = lengthOf(bentPoints) / lengthOf([first, last]);
    const bend = (segment: any) => ({ ...segment, points: bentPoints });
    const bent = {
      ...straight.route,
      segments: straight.route.segments.map(bend),
      edges: straight.route.edges.map((e: any) => ({
        ...e,
        distanceMeters: e.distanceMeters * scale,
        routeSegments: e.routeSegments.map(bend),
      })),
      totalDistanceMeters: straight.route.totalDistanceMeters * scale,
      totalCost: straight.route.totalCost * scale,
      traversalEdges: straight.route.traversalEdges.map((e: any) => ({
        ...e,
        distanceMeters: e.distanceMeters * scale,
        geometryMeters:
          e.geometryMeters == null
            ? e.geometryMeters
            : e.geometryMeters * scale,
      })),
    };
    // Eligible before the closure: current network, no gap, startable.
    const early = call({ op: "inspect", route: bent, now: WILLOW_START - 1 });
    assert.equal(early.network.status, "current");
    assert.equal(early.canNavigate, true);
    assert.equal(startAt(call, bent, first, WILLOW_START - 1).ok, true);
    for (const route of [straight.route, bent]) {
      for (const engineCall of [call, reloaded.call]) {
        for (const now of [WILLOW_START, WILLOW_END + 1]) {
          const inspected = engineCall({ op: "inspect", route, now });
          assert.equal(inspected.network.status, "current");
          assert.equal(inspected.canNavigate, false);
          assert.equal(inspected.closures[0].id, WILLOW_ID);
          assert.equal(startAt(engineCall, route, first, now).ok, false);
        }
      }
    }
  },
);
