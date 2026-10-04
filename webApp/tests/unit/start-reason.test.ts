import { test } from "node:test";
import assert from "node:assert/strict";
import { startBlockedReason } from "../../src/startReason";

const base = {
  canNavigate: true,
  online: true,
  stale: false,
  closureCount: 0,
  estimatedConnections: 0,
};

test("no reason when Start is allowed", () => {
  assert.equal(startBlockedReason(base), null);
});

test("each blocker gets one short, specific reason, in a fixed order", () => {
  assert.match(
    startBlockedReason({
      ...base,
      canNavigate: false,
      stale: true,
      closureCount: 1,
      estimatedConnections: 2,
    })!,
    /Trail data changed. Recalculate/,
  );
  assert.match(
    startBlockedReason({
      ...base,
      canNavigate: false,
      closureCount: 1,
      estimatedConnections: 2,
    })!,
    /closure affects this route/,
  );
  assert.match(
    startBlockedReason({
      ...base,
      canNavigate: false,
      estimatedConnections: 1,
    })!,
    /1 estimated connection is not confirmed/,
  );
  assert.match(
    startBlockedReason({
      ...base,
      canNavigate: false,
      estimatedConnections: 3,
    })!,
    /3 estimated connections are not confirmed/,
  );
  assert.match(
    startBlockedReason({ ...base, canNavigate: false })!,
    /Can't start this route/,
  );
  assert.match(startBlockedReason({ ...base, online: false })!, /offline/);
  // a route blocker is named even while offline
  assert.match(
    startBlockedReason({
      ...base,
      canNavigate: false,
      online: false,
      estimatedConnections: 1,
    })!,
    /estimated connection/,
  );
});

test("the reasons are short enough to sit beside a button", () => {
  for (const input of [
    { ...base, canNavigate: false, estimatedConnections: 12 },
    { ...base, canNavigate: false, stale: true },
    { ...base, online: false },
  ])
    assert.ok(startBlockedReason(input)!.length < 110);
});

test("start and end connections are named when they are part of the count", () => {
  assert.equal(
    startBlockedReason({
      ...base,
      canNavigate: false,
      estimatedConnections: 3,
      endpointConnections: 2,
    }),
    "Can't start: 3 estimated connections (start/end included) are not confirmed by map data. See below.",
  );
  assert.equal(
    startBlockedReason({
      ...base,
      canNavigate: false,
      estimatedConnections: 1,
      endpointConnections: 1,
    }),
    "Can't start: 1 estimated connection (start/end included) is not confirmed by map data. See below.",
  );
});
