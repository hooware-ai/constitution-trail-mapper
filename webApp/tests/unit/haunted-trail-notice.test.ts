import test from "node:test";
import assert from "node:assert/strict";
import {
  hauntedTrailIsPast,
  HAUNTED_TRAIL_PAST_AT,
} from "../../src/HauntedTrailNotice";

test("event notice becomes past after the last Chicago event date, without declaring reopening", () => {
  assert.equal(HAUNTED_TRAIL_PAST_AT, Date.parse("2026-10-25T05:00:00Z"));
  for (const date of [
    "2026-10-13T12:00:00-05:00",
    "2026-10-18T12:00:00-05:00",
    "2026-10-24T23:59:59-05:00",
  ])
    assert.equal(hauntedTrailIsPast(Date.parse(date)), false);
  assert.equal(hauntedTrailIsPast(HAUNTED_TRAIL_PAST_AT), true);
  assert.equal(hauntedTrailIsPast(HAUNTED_TRAIL_PAST_AT + 1), true);
});
