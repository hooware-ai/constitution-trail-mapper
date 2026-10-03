import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Closure gating through the REAL shared Kotlin core, before, during and after the reported closures, plus a notice that
// informs but never blocks. The geometry is synthetic; the closures, their dates and the matching rules are the shared
// core's own (TrailRouteClosureSijko, TrailRouteAdvisorySijko).
//
//  * Uptown trail closure (id uptown-underpass-detour-2026-09-21): blocking, active from 2026-09-21T05:00:00Z, no end
//    date ("a construction target is not a reopening"). A route that rides the closed trail cannot start navigation.
//  * Hamilton/Rhodes work advisory: a notice on road portions of a route. It informs and never blocks.
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

const UPTOWN_ACTIVE_FROM = 1_789_966_800_000; // 2026-09-21T05:00:00Z
const BEFORE = UPTOWN_ACTIVE_FROM - 86_400_000;
const DURING = Date.parse("2026-10-01T15:00:00Z");
const AFTER = Date.parse("2027-10-01T15:00:00Z");

// The county trail line through the Uptown Underpass zone as the shared core draws its approximate corridor (lat, lon).
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
const feature = (id: string, points: [number, number][]) => ({
  id,
  name: `Synthetic ${id}`,
  status: "Existing",
  routeRoles: ["TrailBranches"],
  facilityType: "Separated Trail",
  comfort: "All Ages and Abilities",
  paths: [points.map(([lat, lon]) => [lon, lat])],
});
const network = (...features: object[]) => ({
  source: {},
  layers: [{ id: 54, name: "Synthetic", features }],
});

let instances = 0;
async function engine(trails: object, access?: object) {
  const module: any = await import(
    `${pathToFileURL(corePath).href}?closures=${++instances}`
  );
  const call = (request: unknown) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  const init = call({
    op: "initialize",
    trails: JSON.stringify(trails),
    ...(access ? { access: JSON.stringify(access) } : {}),
    now: DURING,
  });
  assert.equal(init.ok, true);
  return call;
}

// ---- the blocking closure -----------------------------------------------------------------------------------------

const uptown = () =>
  network(
    feature("54:9100", [
      [40.5065, -88.984202],
      [40.507656, -88.984202],
    ]),
    // The closed section, drawn as the shared guide draws it; the core cuts it out of new searches.
    feature("54:1305", CORRIDOR),
    feature("54:9101", [
      [40.509023, -88.984155],
      [40.5105, -88.984155],
    ]),
  );
const south = { latitude: 40.5065, longitude: -88.984202 };
const north = { latitude: 40.5105, longitude: -88.984155 };

test(
  "before the Uptown closure begins a route over the trail can start navigation",
  { skip },
  async () => {
    const call = await engine(uptown());
    const planned = call({
      op: "plan",
      start: south,
      destination: north,
      proposed: false,
      now: BEFORE,
    });
    assert.equal(planned.ok, true);
    assert.deepEqual(planned.closures, []);
    assert.equal(planned.canNavigate, true);
    assert.ok(
      planned.route.edges.some((e: any) => e.sourceFeatureId === "54:1305"),
    );
    assert.ok(!planned.warnings.some((w: string) => /Uptown/.test(w)));
    // The instant it becomes active is the instant it gates: one millisecond earlier it did not.
    const justBefore = call({
      op: "inspect",
      route: planned.route,
      now: UPTOWN_ACTIVE_FROM - 1,
    });
    assert.equal(justBefore.canNavigate, true);
    const atStart = call({
      op: "inspect",
      route: planned.route,
      now: UPTOWN_ACTIVE_FROM,
    });
    assert.equal(atStart.canNavigate, false);
  },
);

test(
  "during the closure a route planned earlier cannot start, a new search finds no route, and recalculating gives the detour guidance",
  { skip },
  async () => {
    const call = await engine(uptown());
    const earlier = call({
      op: "plan",
      start: south,
      destination: north,
      proposed: false,
      now: BEFORE,
    });
    assert.equal(earlier.canNavigate, true);

    const gated = call({ op: "inspect", route: earlier.route, now: DURING });
    assert.equal(gated.ok, true);
    assert.equal(gated.canNavigate, false);
    assert.equal(gated.closures.length, 1);
    assert.equal(gated.closures[0].id, "uptown-underpass-detour-2026-09-21");
    assert.ok(
      gated.warnings.some((w: string) =>
        /Uptown trail detour advisory/.test(w),
      ),
    );
    // There is no "start anyway": opening a ride on this route is refused by the core itself, with the reason.
    const refused = call({
      op: "snapshot",
      route: gated.route,
      point: south,
      accuracy: 5,
      timestamp: DURING,
      progress: 0,
      now: DURING,
    });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /This route cannot start navigation/);
    // The same route is accepted before the closure, so the refusal is the closure's doing and nothing else.
    const accepted = call({
      op: "snapshot",
      route: earlier.route,
      point: south,
      accuracy: 5,
      timestamp: BEFORE,
      progress: 0,
      now: BEFORE,
    });
    assert.equal(accepted.ok, true);

    const fresh = call({
      op: "plan",
      start: south,
      destination: north,
      proposed: false,
      now: DURING,
    });
    assert.equal(fresh.route, null);
    assert.equal(fresh.canNavigate, false);
    assert.match(fresh.error, /No safe route avoids the active trail closure/);
    assert.equal(fresh.closures.length, 1);

    const again = call({
      op: "recalculate",
      route: earlier.route,
      now: DURING,
    });
    assert.equal(again.route, null);
    assert.equal(again.canNavigate, false);
    assert.match(again.error, /No safe route avoids the active trail closure/);
  },
);

test(
  "after the closure's start there is no automatic reopening: the same answers hold a year later",
  { skip },
  async () => {
    const call = await engine(uptown());
    const earlier = call({
      op: "plan",
      start: south,
      destination: north,
      proposed: false,
      now: BEFORE,
    });
    const later = call({ op: "inspect", route: earlier.route, now: AFTER });
    assert.equal(later.canNavigate, false);
    assert.equal(later.closures[0].id, "uptown-underpass-detour-2026-09-21");
    const fresh = call({
      op: "plan",
      start: south,
      destination: north,
      proposed: false,
      now: AFTER,
    });
    assert.equal(fresh.route, null);
  },
);

// ---- the notice that never blocks ---------------------------------------------------------------------------------

const hamiltonAccess = () => ({
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
});
const hamiltonTrail = () =>
  network(
    feature("54:9200", [
      [40.4513, -88.975],
      [40.4533, -88.975],
    ]),
  );
const onRoad = { latitude: 40.4513, longitude: -88.98 };
const trailEnd = { latitude: 40.4533, longitude: -88.975 };

test(
  "a road-work notice informs but never blocks, before, during and after its estimated end",
  { skip },
  async () => {
    const call = await engine(hamiltonTrail(), hamiltonAccess());
    // The official city map now estimates 2026-10-31 18:00 CDT (the older notice said September 30).
    const ESTIMATED_END = 1_793_487_600_000;
    const preStart = call({
      op: "plan",
      start: onRoad,
      destination: trailEnd,
      proposed: false,
      now: Date.parse("2026-08-01T12:00:00Z"),
    });
    assert.equal(preStart.ok, true);
    assert.equal(
      preStart.canNavigate,
      true,
      "the route itself is gap-free and navigable",
    );
    assert.ok(!preStart.warnings.some((w: string) => /Hamilton/.test(w)));

    for (const now of [DURING, ESTIMATED_END + 3 * 86_400_000]) {
      const noticed = call({
        op: "plan",
        start: onRoad,
        destination: trailEnd,
        proposed: false,
        now,
      });
      assert.equal(noticed.ok, true);
      assert.ok(
        noticed.warnings.some((w: string) =>
          /Hamilton\/Rhodes closure advisory/.test(w),
        ),
        "the notice is shown",
      );
      assert.deepEqual(
        noticed.closures,
        [],
        "a notice is not a blocking closure",
      );
      assert.equal(noticed.canNavigate, true, "and it does not stop the ride");
    }
    // After the estimated end the notice stays (an estimate is not a confirmed reopening) and still does not block.
    const afterEnd = call({
      op: "plan",
      start: onRoad,
      destination: trailEnd,
      proposed: false,
      now: ESTIMATED_END + 3 * 86_400_000,
    });
    assert.ok(
      afterEnd.warnings.some((w: string) =>
        /reopening has not been confirmed/.test(w),
      ),
    );
  },
);
