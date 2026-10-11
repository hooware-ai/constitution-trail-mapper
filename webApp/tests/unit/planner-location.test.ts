import test from "node:test";
import assert from "node:assert/strict";
import {
  acquirePlannerLocation,
  PLANNER_LOCATION_TIMEOUT_MS,
  PLANNER_MAX_FIX_ACCURACY_METERS,
  PLANNER_MAX_FIX_AGE_MS,
  usablePlannerFix,
} from "../../src/platform/plannerLocation";
import {
  navigableFix,
  type LocationFailure,
  type LocationFix,
  type LocationPort,
} from "../../src/platform/navigation";

type Event = Parameters<Parameters<typeof acquirePlannerLocation>[1]>[0];
type FailureReason = Extract<Event, { phase: "failure" }>["reason"];
const NOW = 2_000_000_000_000;
const goodFix: LocationFix = {
  latitude: 40.51,
  longitude: -88.95,
  accuracy: 5,
  timestamp: NOW,
};

function fixture(
  options: {
    secureContext?: boolean;
    unsupported?: boolean;
    start?: LocationPort["watch"];
  } = {},
) {
  let now = NOW;
  let watchCalls = 0;
  let success!: (fix: LocationFix) => void;
  let failure!: (error: LocationFailure) => void;
  const events: Event[] = [];
  const clearedWatches: number[] = [];
  const timers = new Map<number, () => void>();
  const scheduled: Array<{ id: number; callback: () => void; delay: number }> =
    [];
  const location: LocationPort = {
    watch(onSuccess, onFailure) {
      watchCalls++;
      success = onSuccess;
      failure = onFailure;
      return options.start ? options.start(onSuccess, onFailure) : 0;
    },
    clearWatch(id) {
      clearedWatches.push(id);
    },
  };
  const cancel = acquirePlannerLocation(
    {
      location: options.unsupported ? undefined : location,
      secureContext: options.secureContext ?? true,
      now: () => now,
      setTimeout(callback, delay) {
        const id = scheduled.length + 1;
        scheduled.push({ id, callback, delay });
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id as number);
      },
    },
    (event) => events.push(event),
  );
  return {
    events,
    cancel,
    clearedWatches,
    timers,
    scheduled,
    watchCalls: () => watchCalls,
    fix(patch: Partial<LocationFix> = {}) {
      success({ ...goodFix, timestamp: now, ...patch });
    },
    fail(code: number) {
      failure({ code, message: "Browser location failure" });
    },
    advance(milliseconds: number) {
      now += milliseconds;
    },
    expire(milliseconds = PLANNER_LOCATION_TIMEOUT_MS) {
      now += milliseconds;
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
  };
}

function expectFailure(f: ReturnType<typeof fixture>, reason: FailureReason) {
  const event = f.events.at(-1);
  assert.equal(event?.phase, "failure");
  assert.ok(event?.phase === "failure");
  assert.equal(event.reason, reason);
  assert.ok(event.message.trim().length > 0);
  assert.equal(f.timers.size, 0);
}

test("planner accepts an accurate location and releases its watch and watchdog", () => {
  const f = fixture();
  assert.equal(f.events.at(-1)?.phase, "waiting");
  assert.equal(f.watchCalls(), 1);
  assert.equal(f.scheduled[0].delay, 20_000);
  assert.equal(PLANNER_LOCATION_TIMEOUT_MS, 20_000);
  f.fix();
  assert.deepEqual(f.events.at(-1), { phase: "success", fix: goodFix });
  assert.deepEqual(f.clearedWatches, [0]);
  assert.equal(f.timers.size, 0);
});

test("a coarse initial location waits for a more accurate reading", () => {
  const f = fixture();
  f.fix({ accuracy: 120 });
  const waiting = f.events.at(-1);
  assert.ok(waiting?.phase === "waiting");
  assert.match(waiting.message, /120\s*m/);
  assert.deepEqual(waiting.approximateFix, { ...goodFix, accuracy: 120 });
  assert.equal(f.timers.size, 1);
  assert.deepEqual(f.clearedWatches, []);
  f.fix({ accuracy: 20 });
  assert.deepEqual(f.events.at(-1), {
    phase: "success",
    fix: { ...goodFix, accuracy: 20 },
  });
  assert.deepEqual(f.clearedWatches, [0]);
  assert.equal(f.timers.size, 0);
});

test("a location that remains coarse fails as inaccurate at the deadline", () => {
  const f = fixture();
  f.fix({ accuracy: 120 });
  f.expire();
  expectFailure(f, "inaccurate");
  const event = f.events.at(-1);
  assert.ok(event?.phase === "failure");
  assert.equal(event.approximateFix, undefined);
  assert.deepEqual(f.clearedWatches, [0]);
});

test("a still-fresh coarse reading remains selectable after the precision deadline", () => {
  const f = fixture();
  f.advance(12_000);
  f.fix({ accuracy: 120 });
  f.expire(8_000);
  const event = f.events.at(-1);
  assert.ok(event?.phase === "failure");
  assert.deepEqual(event.approximateFix, {
    ...goodFix,
    accuracy: 120,
    timestamp: NOW + 12_000,
  });
});

test("the watchdog settles even when a permission prompt produces no callback", () => {
  const f = fixture();
  f.expire();
  expectFailure(f, "timeout");
  assert.deepEqual(f.clearedWatches, [0]);
});

for (const [code, reason] of [
  [1, "denied"],
  [2, "unavailable"],
  [3, "timeout"],
] as const) {
  test(`browser error ${code} reports ${reason} and cleans up`, () => {
    const f = fixture();
    f.fail(code);
    expectFailure(f, reason);
    assert.deepEqual(f.clearedWatches, [0]);
  });
}

test("browser timeout after a valid coarse fix explains the accuracy failure", () => {
  const f = fixture();
  f.fix({ accuracy: 120 });
  f.fail(3);
  expectFailure(f, "inaccurate");
  assert.deepEqual(f.clearedWatches, [0]);
});

test("an insecure page fails before requesting browser location", () => {
  const f = fixture({ secureContext: false });
  expectFailure(f, "insecure");
  assert.equal(f.watchCalls(), 0);
  assert.deepEqual(f.clearedWatches, []);
});

test("missing browser location support fails without starting a watchdog", () => {
  const f = fixture({ unsupported: true });
  expectFailure(f, "unsupported");
  assert.equal(f.watchCalls(), 0);
  assert.deepEqual(f.clearedWatches, []);
});

test("cancelling removes resources and ignores all late browser or timer callbacks", () => {
  const f = fixture();
  const lateTimer = f.scheduled[0].callback;
  f.cancel();
  const beforeLateCallbacks = [...f.events];
  f.fix();
  f.fail(1);
  lateTimer();
  f.cancel();
  assert.deepEqual(f.events, beforeLateCallbacks);
  assert.deepEqual(f.clearedWatches, [0]);
  assert.equal(f.timers.size, 0);
});

test("a settled request ignores late success, failure, and watchdog callbacks", () => {
  const f = fixture();
  const lateTimer = f.scheduled[0].callback;
  f.fix();
  const settledEvents = [...f.events];
  f.fix({ latitude: 41 });
  f.fail(2);
  lateTimer();
  f.cancel();
  assert.deepEqual(f.events, settledEvents);
  assert.deepEqual(f.clearedWatches, [0]);
  assert.equal(f.timers.size, 0);
});

test("invalid or stale locations never become usable or count as valid coarse fixes", () => {
  const f = fixture();
  for (const invalid of [
    { latitude: Number.NaN },
    { latitude: 91 },
    { longitude: -181 },
    { longitude: Number.POSITIVE_INFINITY },
    { accuracy: -1 },
    { accuracy: Number.NaN },
    { timestamp: Number.NaN },
    { timestamp: NOW - 15_001 },
    { timestamp: NOW + 5_001 },
    { accuracy: 120, timestamp: NOW - 15_001 },
    { accuracy: 120, latitude: 91 },
  ]) {
    f.fix(invalid);
    assert.equal(
      f.events.some((event) => event.phase === "success"),
      false,
    );
  }
  f.expire();
  expectFailure(f, "timeout");
});

test("a valid reading can recover after invalid coordinates", () => {
  const f = fixture();
  f.fix({ latitude: Number.NaN });
  f.fix();
  assert.deepEqual(f.events.at(-1), { phase: "success", fix: goodFix });
  assert.equal(f.timers.size, 0);
});

test("planner keeps its own inclusive 35 m / 15 s endpoint limits", () => {
  const f = fixture();
  f.fix({ accuracy: 35, timestamp: NOW - 15_000 });
  assert.deepEqual(f.events.at(-1), {
    phase: "success",
    fix: { ...goodFix, accuracy: 35, timestamp: NOW - 15_000 },
  });
  assert.equal(PLANNER_MAX_FIX_ACCURACY_METERS, 35);
  assert.equal(PLANNER_MAX_FIX_AGE_MS, 15_000);
  const edge = { ...goodFix, accuracy: 35, timestamp: NOW - 15_000 };
  assert.equal(usablePlannerFix(edge, NOW), true);
  assert.equal(usablePlannerFix({ ...edge, accuracy: 35.1 }, NOW), false);
  assert.equal(
    usablePlannerFix({ ...edge, timestamp: NOW - 15_001 }, NOW),
    false,
  );
  assert.equal(
    usablePlannerFix({ ...edge, timestamp: NOW + 5_000 }, NOW),
    true,
  );
  assert.equal(
    usablePlannerFix({ ...edge, timestamp: NOW + 5_001 }, NOW),
    false,
  );
});

test("an endpoint fix navigation would refuse (26–35 m, 11–15 s old, slightly future) is still a precise planner location", () => {
  for (const patch of [
    { accuracy: 26 },
    { accuracy: 35 },
    { timestamp: NOW - 11_000 },
    { timestamp: NOW - 15_000 },
    { timestamp: NOW + 1 },
  ]) {
    const fix = { ...goodFix, ...patch };
    assert.equal(navigableFix(fix, NOW), false, JSON.stringify(patch));
    const f = fixture();
    f.fix(patch);
    assert.deepEqual(f.events.at(-1), { phase: "success", fix });
    assert.deepEqual(f.clearedWatches, [0]);
    assert.equal(f.timers.size, 0);
  }
});

test("a coarse reading stays an explicit approximate offer by the planner's 15 s freshness, not navigation's 10 s", () => {
  const f = fixture();
  f.advance(5_000);
  f.fix({ accuracy: 36 });
  const coarseFix = { ...goodFix, accuracy: 36, timestamp: NOW + 5_000 };
  const waiting = f.events.at(-1);
  assert.ok(waiting?.phase === "waiting");
  assert.deepEqual(waiting.approximateFix, coarseFix);
  // Never adopted automatically: the watch and watchdog keep running.
  assert.equal(f.timers.size, 1);
  assert.deepEqual(f.clearedWatches, []);
  // At the real 20 s watchdog deadline, this reading is 15 s old: past navigation's age limit but still offered.
  f.advance(15_000);
  assert.equal(
    navigableFix({ ...coarseFix, accuracy: 0 }, NOW + 20_000),
    false,
  );
  assert.equal(
    usablePlannerFix({ ...coarseFix, accuracy: 0 }, NOW + 20_000),
    true,
  );
  f.expire(0);
  const offered = f.events.at(-1);
  assert.ok(offered?.phase === "failure");
  assert.equal(offered.reason, "inaccurate");
  assert.deepEqual(offered.approximateFix, coarseFix);
  // One millisecond later the offer has aged out of the planner's window too.
  const aged = fixture();
  aged.advance(4_999);
  aged.fix({ accuracy: 36 });
  aged.expire(15_001);
  const expired = aged.events.at(-1);
  assert.ok(expired?.phase === "failure");
  assert.equal(expired.approximateFix, undefined);
});

test("synchronous startup failure is recoverable and clears the watchdog", () => {
  const f = fixture({
    start() {
      throw new Error("Location could not start");
    },
  });
  expectFailure(f, "startup");
  assert.deepEqual(f.clearedWatches, []);
  f.cancel();
  assert.equal(f.timers.size, 0);
});

test("synchronous success still clears the watch returned after the callback", () => {
  const f = fixture({
    start(success) {
      success(goodFix);
      return 42;
    },
  });
  assert.deepEqual(f.events.at(-1), { phase: "success", fix: goodFix });
  assert.deepEqual(f.clearedWatches, [42]);
  assert.equal(f.timers.size, 0);
  f.cancel();
  assert.deepEqual(f.clearedWatches, [42]);
});

test("synchronous browser failure still clears its subsequently returned watch", () => {
  const f = fixture({
    start(_success, failure) {
      failure({ code: 1 });
      return 42;
    },
  });
  expectFailure(f, "denied");
  assert.deepEqual(f.clearedWatches, [42]);
  f.cancel();
  assert.deepEqual(f.clearedWatches, [42]);
});
