import test from "node:test";
import assert from "node:assert/strict";
import { loopComparison, loopHeading, milesLabel } from "../../src/loopSummary";

test("loop distances are worded as native words them", () => {
  assert.equal(milesLabel(5), "5");
  assert.equal(milesLabel(5.004), "5");
  assert.equal(milesLabel(3.4), "3.4");
  assert.equal(milesLabel(3.48), "3.48");
  assert.equal(milesLabel(5.01), "5.01");
  assert.equal(milesLabel(0.5), "0.5");
  assert.equal(milesLabel(10.78), "10.78");
});

test("the comparison states what was asked and what was found, and the heading says whether the target was met", () => {
  assert.equal(
    loopComparison(8046.72, 7830.19),
    "Requested 5 mi · Found 4.87 mi",
  );
  assert.equal(
    loopComparison(4828.032, 5606.4158),
    "Requested 3 mi · Found 3.48 mi",
  );
  assert.equal(loopHeading(true), "Exercise loop ready");
  assert.equal(loopHeading(false), "Closest available loop");
  // An older result without the flag is not mislabeled as a near miss.
  assert.equal(loopHeading(undefined), "Exercise loop ready");
});
