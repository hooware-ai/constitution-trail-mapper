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
//    22:00Z. An advisory only: the notice gives no trail limits and the city map line is a road line.
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
    const south = plan(call, V97, FROM, WILLOW_START);
    const north = plan(call, TO, V98, WILLOW_START);
    for (const result of [south, north]) {
      assert.equal(result.ok, true);
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

test(
  "Willow: a crossing at the south bound and the trail beyond the north end are unaffected controls",
  { skip },
  async () => {
    const crossingWest = {
      latitude: FROM.latitude,
      longitude: FROM.longitude - 0.0004,
    };
    const crossingEast = {
      latitude: FROM.latitude,
      longitude: FROM.longitude + 0.0004,
    };
    const beyond = {
      latitude: V98.latitude + 0.003,
      longitude: V98.longitude,
    };
    const { call } = await engine(
      network(
        feature("54:1305", [V97, V98]),
        // A shared-lane crossing that meets the trail at the south bound, like 16:188, and the trail beyond the north end.
        feature(
          "16:188",
          [crossingWest, FROM, crossingEast],
          ["SharedRoadways"],
        ),
        feature("54:4349", [V98, beyond]),
      ),
    );
    const cross = plan(call, crossingWest, crossingEast, WILLOW_START - 1);
    assert.equal(cross.ok, true);
    for (const now of [WILLOW_START, WILLOW_END + 1]) {
      const result = call({ op: "inspect", route: cross.route, now });
      assert.equal(result.canNavigate, true, `crossing at ${now}`);
      assert.deepEqual(result.closures, []);
      assert.ok(!result.warnings.some((w: string) => /Willow/.test(w)));
    }
    const northward = plan(call, beyond, V98, WILLOW_START);
    assert.equal(northward.canNavigate, true);
    assert.deepEqual(northward.closures, []);
  },
);

// ---- Camelback: an advisory, never a block ------------------------------------------------------------------------

const CROSSING = { latitude: 40.4982689784, longitude: -88.983416249 };
const BEFORE_V6 = { latitude: 40.4979744336, longitude: -88.9833910595 };
const AFTER_V8 = { latitude: 40.4983674522, longitude: -88.9834245174 };
// Trail ends a short way beyond the actual vertices, so a route has room to snap on both sides of the crossing.
const SOUTH_END = {
  latitude: BEFORE_V6.latitude - 0.0015,
  longitude: BEFORE_V6.longitude + 0.00002,
};
const NORTH_END = {
  latitude: AFTER_V8.latitude + 0.0015,
  longitude: AFTER_V8.longitude - 0.00002,
};
const camelbackTrail = () =>
  feature("54:1304", [SOUTH_END, BEFORE_V6, CROSSING, AFTER_V8, NORTH_END]);
// Own feature id so the Willow cut is not what this exercises; the vertices are the actual 6, crossing, 8 vicinity.
const camelback = () => network(camelbackTrail());

test(
  "Camelback: Scheduled, then an advisory after its start and after the estimate, and it never blocks a plan, a saved route or Start",
  { skip },
  async () => {
    const { call } = await engine(camelback());
    const early = plan(call, SOUTH_END, NORTH_END, CAMEL_START - 1);
    assert.equal(early.canNavigate, true);
    assert.ok(
      early.warnings.some((w: string) => /Scheduled, not closed yet/.test(w)),
    );
    const note = (result: any) =>
      result.warnings.find((w: string) => /Camelback/.test(w));
    for (const now of [
      CAMEL_START - 1,
      CAMEL_START,
      CAMEL_END,
      CAMEL_END + 1,
    ]) {
      const result = call({ op: "inspect", route: early.route, now });
      assert.equal(result.canNavigate, true, `blocked at ${now}`);
      assert.deepEqual(result.closures, []);
      assert.ok(note(result), `no notice at ${now}`);
      assert.match(note(result), /no closure limits along the trail/);
      const start = call({
        op: "snapshot",
        route: early.route,
        point: SOUTH_END,
        accuracy: 5,
        timestamp: now,
        progress: 0,
        now,
      });
      assert.equal(start.ok, true, `Start refused at ${now}`);
    }
    assert.match(
      note(call({ op: "inspect", route: early.route, now: CAMEL_START })),
      /closed Constitution Trail from 8 a\.m\. CDT/,
    );
    assert.match(
      note(call({ op: "inspect", route: early.route, now: CAMEL_END + 1 })),
      /has passed; reopening has not been confirmed/,
    );
    // A trail elsewhere has no notice.
    const away = await engine(
      network(
        feature("54:68", [
          { latitude: 40.499, longitude: -88.99 },
          { latitude: 40.5, longitude: -88.99 },
        ]),
      ),
    );
    const elsewhere = plan(
      away.call,
      { latitude: 40.499, longitude: -88.99 },
      { latitude: 40.5, longitude: -88.99 },
      CAMEL_START,
    );
    assert.ok(!elsewhere.warnings.some((w: string) => /Camelback/.test(w)));
  },
);

test(
  "Both closures in force together: Willow gates, Camelback only warns, and each keeps its own instant",
  { skip },
  async () => {
    const { call, init } = await engine(
      network(feature("54:1305", [V97, V98]), camelbackTrail()),
      CAMEL_START,
    );
    assert.ok(init.closures.some((c: any) => c.id === WILLOW_ID));
    assert.ok(!init.closures.some((c: any) => /camelback/.test(c.id)));
    const savedWillow = plan(call, V97, V98, WILLOW_START - 1).route;
    const savedCamel = plan(call, SOUTH_END, NORTH_END, CAMEL_START - 1).route;
    // Between the two starts only Willow is in force; from the second, still only Willow blocks.
    for (const now of [WILLOW_START, CAMEL_START, CAMEL_END + 1]) {
      const w = call({ op: "inspect", route: savedWillow, now });
      const c = call({ op: "inspect", route: savedCamel, now });
      assert.equal(w.canNavigate, false, `Willow route at ${now}`);
      assert.equal(c.canNavigate, true, `Camelback route at ${now}`);
      assert.equal(w.closures[0].id, WILLOW_ID);
      assert.deepEqual(c.closures, []);
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
    assert.match(
      old.details,
      /that estimate has passed and completion was not confirmed/,
    );
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
  : "the private native asset data/generated/mcgis-trails.normalized.json is not present (the sharedLogic TimedClosureRealDataTest and this file's other tests run without it)";

test(
  "Willow on the actual 54:1305 path from the native asset: raw leg unchanged, clipped inside leg 97->98, residuals usable, neighbors untouched",
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
    const { call, init } = await engine(text, WILLOW_START);
    // The loaded line is exactly the source line, whatever the closure cut at plan time.
    const loaded = init.features.find((f: any) => f.id === "54:1305");
    assert.deepEqual(
      loaded.paths[0],
      real.map(([longitude, latitude]: number[]) => ({ latitude, longitude })),
    );
    const drawn = init.closures.find((c: any) => c.id === WILLOW_ID);
    assert.deepEqual(drawn.points, [FROM, TO]);
    // Residual portions on the real network.
    for (const [from, to] of [
      [V97, FROM],
      [TO, V98],
    ] as const) {
      const result = plan(call, from, to, WILLOW_START);
      assert.equal(result.canNavigate, true);
      assert.deepEqual(result.closures, []);
    }
    // The route planned a day earlier rides the section and is gated from the instant; an unaffected neighbor is not.
    const earlier = plan(call, V97, V98, WILLOW_START - 1);
    assert.equal(earlier.canNavigate, true);
    assert.equal(
      call({ op: "inspect", route: earlier.route, now: WILLOW_START })
        .canNavigate,
      false,
    );
    const crossing = all.find((f: any) => f.id === "16:188").paths[0];
    const near = crossing.findIndex(
      (p: number[]) =>
        Math.hypot(p[0] - FROM.longitude, p[1] - FROM.latitude) < 0.0002,
    );
    if (near >= 0) {
      const a = crossing[Math.max(0, near - 1)];
      const b = crossing[Math.min(crossing.length - 1, near + 1)];
      const route = plan(
        call,
        { latitude: a[1], longitude: a[0] },
        { latitude: b[1], longitude: b[0] },
        WILLOW_START - 1,
      );
      if (route.route) {
        assert.equal(
          call({ op: "inspect", route: route.route, now: WILLOW_START })
            .canNavigate,
          true,
        );
      }
    }
  },
);
