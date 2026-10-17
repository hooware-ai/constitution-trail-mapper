import { test } from "node:test";
import assert from "node:assert/strict";
import { startBlockedReason } from "../../src/startReason";

const base = {
  canNavigate: true,
  online: true,
  stale: false,
  closureCount: 0,
};

test("no reason when Start is allowed, including routes with estimated connections", () => {
  assert.equal(startBlockedReason(base), null);
});

test("actual blockers get specific reasons without blaming missing map metadata", () => {
  assert.match(
    startBlockedReason({
      ...base,
      canNavigate: false,
      stale: true,
      closureCount: 1,
    })!,
    /Trail data changed. Recalculate/,
  );
  assert.match(
    startBlockedReason({ ...base, canNavigate: false, closureCount: 1 })!,
    /closure affects this route/,
  );
  assert.equal(
    startBlockedReason({ ...base, canNavigate: false }),
    "Can't start this route. See the notices below.",
  );
  assert.match(startBlockedReason({ ...base, online: false })!, /offline/);
  assert.match(
    startBlockedReason({
      ...base,
      canNavigate: false,
      online: false,
      closureCount: 1,
    })!,
    /closure/,
  );
});

test("reasons remain short beside the button", () => {
  for (const input of [
    { ...base, canNavigate: false },
    { ...base, canNavigate: false, stale: true },
    { ...base, online: false },
  ])
    assert.ok(startBlockedReason(input)!.length < 110);
});
