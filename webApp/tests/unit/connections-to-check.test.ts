import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionsToCheck } from "../../src/gapDistance";
import type { AccessGap } from "../../src/types";

const gap = (id: string, kind?: "endpoint" | "interior"): AccessGap => ({
  id,
  kind,
  distanceMeters: 5,
  from: { latitude: 40, longitude: -89 },
  to: { latitude: 40.0001, longitude: -89 },
  label: id,
});

test("start and destination connections are not announced; interior ones are, in order", () => {
  const gaps = [
    gap("gap-0", "endpoint"),
    gap("gap-2", "interior"),
    gap("gap-4", "interior"),
    gap("gap-6", "endpoint"),
  ];
  assert.deepEqual(
    connectionsToCheck(gaps).map((g) => g.id),
    ["gap-2", "gap-4"],
  );
  // the input is not changed: the endpoint connections stay in the route data for the map, counts and warnings
  assert.equal(gaps.length, 4);
});

test("a gap with no kind (an older answer) is announced rather than hidden", () => {
  assert.deepEqual(
    connectionsToCheck([gap("gap-1")]).map((g) => g.id),
    ["gap-1"],
  );
  assert.deepEqual(connectionsToCheck([gap("gap-0", "endpoint")]), []);
});
