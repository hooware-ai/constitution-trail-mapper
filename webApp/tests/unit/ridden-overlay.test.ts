import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { lengthMeters, riddenPolylines } from "../../src/ridden";

// The ridden overlay is derived from the shared core's own cue pieces (navigation distance at every point), so what is
// faded on the map is exactly what navigation counts as ridden.
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

async function cues() {
  const module: any = await import(
    pathToFileURL(corePath).href + "?ridden-overlay=1"
  );
  const call = (request: unknown) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  const trails = readFileSync(
    join(process.cwd(), "src", "data", "review-network.json"),
    "utf8",
  );
  call({ op: "initialize", trails, trustSerializedRoutes: true, now: NOW });
  const loop = call({
    op: "plan",
    start: { latitude: 40.51, longitude: -88.95 },
    miles: 1,
    proposed: false,
    now: NOW,
  });
  return { loop, made: call({ op: "mapCues", route: loop.route }) };
}
const total = (lines: { latitude: number; longitude: number }[][]) =>
  lines.reduce((sum, line) => sum + lengthMeters(line), 0);

test(
  "nothing is ridden before departure, the ridden length grows with progress, and a finished route is entirely ridden",
  { skip },
  async () => {
    const { loop, made } = await cues();
    assert.deepEqual(riddenPolylines(made.pieces, 0), []);
    assert.deepEqual(riddenPolylines(made.pieces, -5), []);
    assert.deepEqual(riddenPolylines(made.pieces, Number.NaN), []);
    let last = 0;
    for (const meters of [100, 400, 700, 1000, 1400]) {
      const length = total(riddenPolylines(made.pieces, meters));
      assert.ok(length >= last, "never shrinks");
      // The overlay's length is the progress, to within the offset geometry's small difference from the planned line.
      assert.ok(
        Math.abs(length - Math.min(meters, loop.distance)) <
          Math.max(25, meters * 0.03),
        `${length} for ${meters}`,
      );
      last = length;
    }
    const all = riddenPolylines(made.pieces, loop.distance + 500);
    assert.equal(all.length, made.pieces.length);
  },
);

test(
  "a ridden second pass follows its own offset line, so the overlay covers the line the rider sees",
  { skip },
  async () => {
    const { loop, made } = await cues();
    const indexOfSecond = made.pieces.findIndex(
      (p: any) => p.repeatsEarlierTravel,
    );
    assert.ok(indexOfSecond >= 0, "an out-and-back loop has a second pass");
    const piece = made.pieces[indexOfSecond];
    // Ridden through the middle of the second pass: every full vertex before the cut is that piece's own (offset) vertex.
    const middle = (piece.distances[0] + piece.distances.at(-1)) / 2;
    const lines = riddenPolylines(made.pieces, middle);
    const mine = lines.find(
      (line) =>
        line[0].latitude === piece.points[0].latitude &&
        line[0].longitude === piece.points[0].longitude,
    );
    assert.ok(mine, "the second pass starts on its own offset line");
    assert.ok(mine!.length >= 2 && mine!.length <= piece.points.length);
    for (let i = 0; i < mine!.length - 1; i++)
      assert.deepEqual(mine![i], piece.points[i]);
    assert.ok(loop.distance > middle);
  },
);

test("malformed pieces are skipped rather than drawn", () => {
  const point = { latitude: 40, longitude: -89 };
  const pieces = [
    {
      points: [point],
      type: "Trail",
      isRouted: true,
      roles: [],
      name: null,
      repeatsEarlierTravel: false,
      distances: [0],
    },
    {
      points: [point, { latitude: 40.001, longitude: -89 }],
      type: "Trail",
      isRouted: true,
      roles: [],
      name: null,
      repeatsEarlierTravel: false,
      distances: [0],
    },
  ];
  assert.deepEqual(riddenPolylines(pieces, 100), []);
});
