import test from "node:test";
import assert from "node:assert/strict";
import { applyReverse, reverseOutcome } from "../../src/reverseGate";

const blocked = {
  canNavigate: false,
  warnings: ["Uptown trail detour advisory: closed."],
};
const fine = { canNavigate: true, warnings: [] };
const controls = () => {
  const calls: string[] = [];
  return {
    calls,
    controls: {
      start: (record: unknown) => calls.push(`start:${JSON.stringify(record)}`),
      stop: () => calls.push("stop"),
    },
  };
};

test("a blocked verdict inside a ride stops the ride (never keeps the old guidance live) and says why", () => {
  const decision = reverseOutcome(blocked, true);
  assert.equal(decision.kind, "stop-ride");
  if (decision.kind === "stop-ride") {
    assert.match(decision.message, /Navigation stopped/);
    assert.match(decision.message, /in either direction/);
    assert.match(decision.message, /observed on this ride was cleared/);
    assert.match(decision.message, /Uptown trail detour advisory/);
  }
  const { calls, controls: c } = controls();
  assert.equal(applyReverse(decision, true, c, { key: "reversed" }), false);
  assert.deepEqual(
    calls,
    ["stop"],
    "stopped, and the reversed route was never started",
  );
});

test("a good verdict inside a ride restarts it on the reversed route; outside a ride nothing is started", () => {
  const live = controls();
  assert.equal(
    applyReverse(reverseOutcome(fine, true), true, live.controls, { key: "r" }),
    true,
  );
  assert.deepEqual(live.calls, ['start:{"key":"r"}']);
  // A preview has no ride to restart, even for a route that cannot be navigated: its Start control carries the verdict.
  const preview = controls();
  const decision = reverseOutcome(blocked, false);
  assert.equal(decision.kind, "proceed");
  assert.equal(
    applyReverse(decision, false, preview.controls, { key: "r" }),
    true,
  );
  assert.deepEqual(preview.calls, []);
});

test("a missing controller is tolerated and the decision still holds", () => {
  const decision = reverseOutcome(blocked, true);
  assert.equal(applyReverse(decision, true, null, null), false);
  assert.equal(
    reverseOutcome({ canNavigate: false, warnings: undefined as never }, true)
      .kind,
    "stop-ride",
  );
});
