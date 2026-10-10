import test from "node:test";
import assert from "node:assert/strict";
import {
  itineraryDistances,
  itineraryDistanceLabel,
} from "../../src/itinerary";

const instructions = (...distances: number[]) =>
  distances.map((distance) => ({ text: "Step", distance }));

test("bridge leg distances accumulate; next-step distance is the next leg, not a subtraction", () => {
  const steps = itineraryDistances(instructions(0, 500, 100));
  assert.deepEqual(steps, [
    { fromStart: 0, toNext: 500, last: false },
    { fromStart: 500, toNext: 100, last: false },
    { fromStart: 600, toNext: null, last: true },
  ]);
  assert.equal(
    itineraryDistanceLabel(steps[0]),
    "0 ft from start · 0.3 mi to next step",
  );
  assert.equal(
    itineraryDistanceLabel(steps[1]),
    "0.3 mi from start · 328 ft to next step",
  );
  assert.equal(
    itineraryDistanceLabel(steps[2]),
    "0.4 mi from start · Last step",
  );
});

test("zero-length successive instructions retain their order and truthful distances", () => {
  assert.deepEqual(itineraryDistances(instructions(0, 0)), [
    { fromStart: 0, toNext: 0, last: false },
    { fromStart: 0, toNext: null, last: true },
  ]);
  assert.equal(
    itineraryDistanceLabel(itineraryDistances(instructions(0))[0]),
    "0 ft from start · Last step",
  );
  assert.deepEqual(itineraryDistances([]), []);
});

test("invalid leg distances and overflow are unavailable, never clamped into invented positions", () => {
  for (const invalid of [-1, NaN, Infinity]) {
    const steps = itineraryDistances(instructions(0, invalid, 100));
    assert.equal(steps[0].toNext, null);
    assert.equal(steps[1].fromStart, null);
    assert.equal(steps[2].fromStart, null);
    assert.equal(
      itineraryDistanceLabel(steps[0]),
      "0 ft from start · Distance to next step unavailable",
    );
    assert.equal(
      itineraryDistanceLabel(steps[2]),
      "Distance from start unavailable · Last step",
    );
  }
  assert.equal(
    itineraryDistances(instructions(Number.MAX_VALUE, Number.MAX_VALUE))[1]
      .fromStart,
    null,
  );
});
