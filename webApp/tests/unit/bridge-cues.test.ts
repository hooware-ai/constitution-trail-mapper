import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The map cues through the REAL shared core, as native draws them: direction-ordered pieces, a second pass drawn beside the
// first, and where a route turns back.
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
  const module: any = await import(pathToFileURL(corePath).href + "?cues=1");
  const call = (request: unknown) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  const trails = readFileSync(
    join(process.cwd(), "src", "data", "review-network.json"),
    "utf8",
  );
  call({ op: "initialize", trails, trustSerializedRoutes: true, now: NOW });
  return call;
}
const meters = (a: any, b: any) =>
  Math.hypot(
    (b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180),
    b.latitude - a.latitude,
  ) * 111320;

// A straight trail with a dead end: a loop on it can only go out and come back, so it turns around exactly once.
const outAndBack = {
  source: {},
  layers: [
    {
      id: 1,
      name: "Synthetic",
      features: [
        {
          id: "t1",
          name: "Synthetic dead end",
          status: "Existing",
          routeRoles: ["TrailBranches"],
          facilityType: "Separated Trail",
          comfort: "All Ages and Abilities",
          paths: [
            [0, 0.01, 0.02, 0.03, 0.04, 0.05].map((d) => [-88.95, 40.5 + d]),
          ],
        },
      ],
    },
  ],
};

test(
  "an out-and-back loop has a second pass drawn beside the first, and says where it turns around",
  { skip },
  async () => {
    const module: any = await import(
      pathToFileURL(corePath).href + "?cues=dead"
    );
    const call = (request: unknown) =>
      JSON.parse(module.dispatch(JSON.stringify(request)));
    call({ op: "initialize", trails: JSON.stringify(outAndBack), now: NOW });
    const loop = call({
      op: "plan",
      start: { latitude: 40.5, longitude: -88.95 },
      miles: 2,
      proposed: false,
      now: NOW,
    });
    assert.equal(loop.ok, true, loop.error);
    const cues = call({ op: "mapCues", route: loop.route });
    assert.equal(cues.ok, true);
    const second = cues.pieces.filter((p: any) => p.repeatsEarlierTravel);
    const first = cues.pieces.filter((p: any) => !p.repeatsEarlierTravel);
    assert.ok(second.length > 0 && first.length > 0);
    assert.equal(cues.turnarounds.length, 1, "one U-turn at the dead end");
    // About half way round (the far end), with a finite position on the trail.
    const turn = cues.turnarounds[0];
    assert.ok(
      Math.abs(turn.distance - loop.distance / 2) < loop.distance * 0.1,
      `${turn.distance} of ${loop.distance}`,
    );
    assert.ok(Math.abs(turn.point.longitude - -88.95) < 0.0005);
    // Every piece carries one navigation distance per point, in order along the route.
    for (const piece of cues.pieces) {
      assert.equal(piece.distances.length, piece.points.length);
      assert.deepEqual(
        [...piece.distances].sort((a: number, b: number) => a - b),
        piece.distances,
      );
    }
    // The way back is shifted to the RIGHT of travel by about 8 m, so both passes stay visible: heading south on a
    // north-south trail, right is west.
    const back = second[0].points;
    const dLon =
      (back[0].longitude - -88.95) * Math.cos((40.52 * Math.PI) / 180) * 111320;
    assert.ok(
      dLon < -6 && dLon > -10,
      `about 8 m west of the trail (${dLon.toFixed(1)} m)`,
    );
    assert.ok(
      back[0].latitude > back.at(-1).latitude,
      "in the direction of travel (southbound)",
    );
    // The first pass is the trail itself, unshifted, heading north.
    assert.ok(first[0].points[0].latitude < first[0].points.at(-1).latitude);
    assert.ok(Math.abs(first[0].points[0].longitude - -88.95) < 1e-9);
  },
);

test(
  "a route that never turns back has no turnarounds and no second pass, and cues describe every drawn stretch",
  { skip },
  async () => {
    const call = await engine();
    const pair = call({
      op: "plan",
      start: west,
      destination: east,
      proposed: false,
      now: NOW,
    });
    const cues = call({ op: "mapCues", route: pair.route });
    assert.equal(cues.turnarounds.length, 0);
    assert.ok(cues.pieces.every((p: any) => p.repeatsEarlierTravel === false));
    // The pieces cover the same distance the route reports (the drawable merge keeps the whole line).
    const drawn = cues.pieces.reduce(
      (sum: number, p: any) =>
        sum +
        p.points
          .slice(1)
          .reduce(
            (n: number, q: any, i: number) => n + meters(p.points[i], q),
            0,
          ),
      0,
    );
    assert.ok(
      Math.abs(drawn - pair.distance) < pair.distance * 0.02,
      `${drawn} close to ${pair.distance}`,
    );
    assert.equal(call({ op: "mapCues", route: { nonsense: true } }).ok, false);
  },
);
