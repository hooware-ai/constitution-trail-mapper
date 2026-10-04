import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestBearing, nextRideHeading } from "../../src/rideCamera";
import type { LocationFix } from "../../src/platform/navigation";

const fix = (
  latitude: number,
  longitude: number,
  timestamp: number,
  extra: Partial<LocationFix> = {},
): LocationFix => ({ latitude, longitude, timestamp, accuracy: 5, ...extra });

test("moving browser heading drives the camera and wraps across north", () => {
  const state = nextRideHeading(
    null,
    fix(40.5, -88.95, 1000, { heading: 359, speed: 4 }),
  );
  assert.equal(state.bearing, 359);
  assert.equal(nearestBearing(359, 1), 361);
});

test("stationary jitter keeps the last reliable direction", () => {
  const first = nextRideHeading(
    null,
    fix(40.5, -88.95, 1000, { heading: 90, speed: 5 }),
  );
  const jitter = nextRideHeading(
    first,
    fix(40.500015, -88.95001, 2000, { heading: 270, speed: 0 }),
  );
  assert.equal(jitter.bearing, 90);
});

test("without device heading, significant travel establishes direction", () => {
  const first = nextRideHeading(null, fix(40.5, -88.95, 1000));
  assert.equal(first.bearing, null);
  const east = nextRideHeading(first, fix(40.5, -88.9497, 4000));
  assert.ok(east.bearing !== null && Math.abs(east.bearing - 90) < 1);
});

test("old or inaccurate fixes do not invent a direction", () => {
  const first = nextRideHeading(null, fix(40.5, -88.95, 1000));
  assert.equal(nextRideHeading(first, fix(40.5, -88.949, 25000)).bearing, null);
  assert.equal(
    nextRideHeading(first, fix(40.5, -88.949, 2500, { accuracy: 50 })).bearing,
    null,
  );
  assert.equal(
    nextRideHeading(first, fix(40.5, -88.9497, 4000, { speed: 0 })).bearing,
    null,
  );
});
