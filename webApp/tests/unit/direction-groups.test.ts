import test from "node:test";
import assert from "node:assert/strict";
import { directionGroupStarts } from "../../src/directionGroups";
import type { RouteResult } from "../../src/types";
const a = { latitude: 40, longitude: -89 };
const b = { latitude: 40.001, longitude: -89 };
const c = { latitude: 40.002, longitude: -89 };
const d = { latitude: 40.003, longitude: -89 };
const route = () =>
  ({
    segments: [
      { type: "Access", points: [a, b] },
      { type: "Trail", points: [b, c] },
      { type: "Access", points: [c, d] },
    ],
    instructions: [
      { text: "Start", maneuver: "Start", distance: 0, point: a },
      { text: "Enter trail", maneuver: "Continue", distance: 111, point: b },
      { text: "Exit", maneuver: "Continue", distance: 111, point: c },
      { text: "Arrive", maneuver: "Arrive", distance: 111, point: d },
    ],
    accessGaps: [],
  }) as unknown as RouteResult;
test("unique core boundaries label all contiguous phases without changing any instructions", () => {
  const r = route();
  const before = JSON.stringify(r);
  const refs = r.instructions.slice();
  assert.deepEqual(
    [...directionGroupStarts(r)],
    [
      [0, "Access"],
      [1, "Trail"],
      [2, "Access"],
    ],
  );
  assert.equal(JSON.stringify(r), before);
  r.instructions.forEach((i, n) => assert.equal(i, refs[n]));
  r.segments[1].roles = ["SharedRoadways"];
  assert.equal(directionGroupStarts(r).get(1), "Trail and shared roadway");
});
test("gaps, deferred boundaries, revisits, missing points and unknown types retain the flat list", () => {
  const cases: RouteResult[] = [];
  let r = route();
  r.accessGaps = [{} as any];
  cases.push(r);
  r = route();
  r.instructions.splice(1, 1);
  cases.push(r);
  r = route();
  r.segments[2].points.push(b);
  cases.push(r);
  r = route();
  delete r.instructions[1].point;
  cases.push(r);
  r = route();
  r.segments[1].type = "Unknown";
  cases.push(r);
  r = route();
  r.instructions.push({ ...r.instructions[1] });
  cases.push(r);
  cases.forEach((r) => assert.equal(directionGroupStarts(r).size, 0));
});
test("turnarounds never create return groups and a single trail stays flat", () => {
  const r = route();
  r.instructions[1].maneuver = "TurnAround";
  assert.deepEqual(
    [...directionGroupStarts(r).values()],
    ["Access", "Trail", "Access"],
  );
  r.segments = [{ type: "Trail", points: [a, b, c, d] }];
  assert.equal(directionGroupStarts(r).size, 0);
});
