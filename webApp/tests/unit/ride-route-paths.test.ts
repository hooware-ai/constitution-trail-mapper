import { test } from "node:test";
import assert from "node:assert/strict";
import { rideRoutePaths } from "../../src/rideRoutePaths";
import { riddenPolylines } from "../../src/ridden";
import type { MapCues, Point, RouteResult } from "../../src/types";

const start: Point = { latitude: 40.5, longitude: -88.95 };
const end: Point = { latitude: 40.501, longitude: -88.95 };
const returnOffset: Point = { latitude: 40.501, longitude: -88.9499 };
const startOffset: Point = { latitude: 40.5, longitude: -88.9499 };

test("a retraced return pass stays beneath its ridden overlay", () => {
  const route = {
    segments: [
      { type: "Trail", points: [start, end] },
      { type: "Trail", points: [end, start] },
    ],
  } as RouteResult;
  const cues: MapCues = {
    turnarounds: [],
    pieces: [
      {
        type: "Trail",
        points: [start, end],
        isRouted: true,
        roles: [],
        name: null,
        repeatsEarlierTravel: false,
        distances: [0, 100],
      },
      {
        type: "Trail",
        points: [returnOffset, startOffset],
        isRouted: true,
        roles: [],
        name: null,
        repeatsEarlierTravel: true,
        distances: [100, 200],
      },
    ],
  };
  const drawn = rideRoutePaths(route, cues);
  assert.deepEqual(drawn.mapped[1], riddenPolylines(cues.pieces, 200)[1]);
  assert.notDeepEqual(drawn.mapped[1], route.segments[1].points);
  assert.deepEqual(rideRoutePaths(route, null).mapped[1], [end, start]);
});
