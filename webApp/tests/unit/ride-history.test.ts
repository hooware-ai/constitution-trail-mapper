import test from "node:test";
import assert from "node:assert/strict";
import {
  ForegroundNavigationController,
  type LocationFix,
  type NavigationClock,
  type NavigationGuidance,
} from "../../src/platform/navigation";
import {
  CARRIED_RIDE_KEY,
  COMPLETED_SESSIONS_KEY,
  CarriedRideStore,
  CompletedSessionStore,
  MAX_COMPLETED_SESSIONS,
  newestSessionsFirst,
  type CompletedSession,
  type RouteRecord,
  type StoragePort,
} from "../../src/platform/storage";

const NOW = 2_000_000_000_000;
const memory = (failWrites = false) => {
  const values = new Map<string, string>();
  const storage: StoragePort = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) {
        const error = new Error("full");
        error.name = "QuotaExceededError";
        throw error;
      }
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { values, storage };
};
const session = (
  id: string,
  at: number,
  extra: object = {},
): CompletedSession => ({
  id,
  routeKey: `exercise:${id}`,
  completedAtEpochMillis: at,
  completedDistanceMeters: 5000,
  traversalEdges: [{ key: "a", distanceMeters: 100 }],
  ...extra,
});

// ---- completed sessions -----------------------------------------------------------------------------------------------

test("completed sessions are kept newest first, one per id, at most the newest 100", () => {
  const { storage } = memory();
  const store = new CompletedSessionStore(storage);
  assert.deepEqual(store.read(), { ok: true, state: [] });
  store.record(session("a", 1000));
  store.record(session("b", 3000));
  store.record(session("c", 2000));
  assert.deepEqual(
    store.read().state.map((s) => s.id),
    ["b", "c", "a"],
  );
  // Recording the same id again replaces it rather than duplicating it.
  store.record(session("a", 4000, { completedDistanceMeters: 6000 }));
  const again = store.read().state;
  assert.deepEqual(
    again.map((s) => s.id),
    ["a", "b", "c"],
  );
  assert.equal(again[0].completedDistanceMeters, 6000);
  // The bound is native's: the newest 100.
  for (let n = 0; n < MAX_COMPLETED_SESSIONS + 20; n++)
    store.record(session(`s${n}`, 10_000 + n));
  const all = store.read().state;
  assert.equal(all.length, MAX_COMPLETED_SESSIONS);
  assert.equal(all[0].id, `s${MAX_COMPLETED_SESSIONS + 19}`);
  assert.ok(!all.some((s) => s.id === "a"), "the oldest were dropped");
  assert.deepEqual(
    newestSessionsFirst([
      session("x", 1),
      session("x", 2),
      session("y", 0),
    ]).map((s) => s.id),
    ["x", "y"],
  );
});

test("a malformed record is refused, an unreadable history is never overwritten, and a full browser says so", () => {
  const { storage, values } = memory();
  const store = new CompletedSessionStore(storage);
  assert.equal(store.record({ id: "x" }).ok, false);
  assert.equal(store.record(session("a", -5)).ok, false);
  assert.equal(
    store.record(session("a", 1, { traversalEdges: "no" })).ok,
    false,
  );
  assert.equal(store.read().state.length, 0);

  values.set(COMPLETED_SESSIONS_KEY, "{not json");
  assert.deepEqual(store.read(), { ok: false, state: [], error: "corrupt" });
  assert.equal(store.record(session("a", 1)).ok, false);
  assert.equal(
    values.get(COMPLETED_SESSIONS_KEY),
    "{not json",
    "left for the rider, not overwritten",
  );
  values.set(
    COMPLETED_SESSIONS_KEY,
    JSON.stringify({ version: 2, sessions: [] }),
  );
  assert.equal(store.read().error, "unsupported-version");
  values.set(
    COMPLETED_SESSIONS_KEY,
    JSON.stringify({ version: 1, sessions: [{ id: "bad" }] }),
  );
  assert.equal(store.read().error, "corrupt");

  const full = new CompletedSessionStore(memory(true).storage);
  const result = full.record(session("a", 1));
  assert.equal(result.ok, false);
  assert.equal(result.error, "quota");
  assert.equal(new CompletedSessionStore(memory().storage).clear().ok, true);
});

// ---- the carried ride --------------------------------------------------------------------------------------------------

test("a carried ride is tied to the route it belongs to, and anything unreadable counts as nothing carried", () => {
  const { storage, values } = memory();
  const store = new CarriedRideStore(storage);
  assert.equal(store.read(), null);
  const carried = {
    distanceMeters: 1200,
    traversalEdges: [{ key: "k", distanceMeters: 1200 }],
  };
  assert.equal(store.write({ recordKey: "route-b", carried }), true);
  assert.deepEqual(store.read(), { recordKey: "route-b", carried });
  for (const bad of [
    "{nope",
    JSON.stringify({ version: 1, recordKey: "", carried }),
    JSON.stringify({
      version: 1,
      recordKey: "k",
      carried: { distanceMeters: -1, traversalEdges: [] },
    }),
    JSON.stringify({
      version: 1,
      recordKey: "k",
      carried: { distanceMeters: 1, traversalEdges: "x" },
    }),
    JSON.stringify({ version: 2, recordKey: "k", carried }),
  ]) {
    values.set(CARRIED_RIDE_KEY, bad);
    assert.equal(store.read(), null);
  }
  store.clear();
  assert.equal(values.has(CARRIED_RIDE_KEY), false);
  assert.equal(
    new CarriedRideStore(memory(true).storage).write({
      recordKey: "k",
      carried,
    }),
    false,
  );
});

// ---- the controller reports a finished loop once -----------------------------------------------------------------------

const record = (kind: string): RouteRecord => ({
  key: `route-${kind}`,
  title: "A route",
  createdAt: NOW,
  usedAt: NOW,
  route: { kind },
  draft: {
    mode: "loop",
    start: null,
    destination: null,
    miles: 5,
    proposed: false,
  },
});
function ride() {
  let now = NOW;
  let guidance: Partial<NavigationGuidance> & { arrived?: boolean } = {};
  const arrived: string[] = [];
  const clock: NavigationClock = {
    now: () => now,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  let push: (fix: LocationFix) => void = () => {};
  const controller = new ForegroundNavigationController({
    location: {
      watch: (success) => {
        push = success;
        return 0;
      },
      clearWatch: () => {},
    },
    clock,
    evaluate: async () =>
      ({
        routeProgressMeters: 900,
        distanceFromRouteMeters: 2,
        instruction: "Continue",
        remainingMeters: 100,
        ...guidance,
      }) as NavigationGuidance,
    onArrived: (finished) => arrived.push(finished.key),
  });
  return {
    controller,
    arrived,
    async fix(next: typeof guidance) {
      guidance = next;
      now += 5000;
      push({ latitude: 40, longitude: -89, accuracy: 10, timestamp: now });
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
  };
}

test("a completed exercise loop is reported once per ride, and only when the router says it arrived on route", async () => {
  const r = ride();
  r.controller.start(record("ExerciseLoop"));
  await r.fix({ arrived: false });
  assert.deepEqual(r.arrived, []);
  // Arrived but far from the route (a deviation): not a completion.
  await r.fix({ arrived: true, distanceFromRouteMeters: 200 });
  assert.deepEqual(r.arrived, []);
  await r.fix({ arrived: true });
  assert.deepEqual(r.arrived, ["route-ExerciseLoop"]);
  await r.fix({ arrived: true });
  assert.equal(r.arrived.length, 1, "once per ride");
  // A new ride may be reported again.
  r.controller.start(record("ExerciseLoop"));
  await r.fix({ arrived: true });
  assert.equal(r.arrived.length, 2);
});

test("arriving at a point-to-point destination is not a loop completion", async () => {
  const r = ride();
  r.controller.start(record("PointToPoint"));
  await r.fix({ arrived: true });
  assert.deepEqual(r.arrived, []);
});

// ---- ridden progress survives a reload apart from the matched position ----------------------------------------------------

import { ActiveRideStore } from "../../src/platform/storage";

function persistedRide(options: { legacy?: boolean } = {}) {
  const { storage, values } = memory();
  let now = NOW;
  let push: (fix: LocationFix) => void = () => {};
  const seen: { previousRidden: number; previousProgress: number }[] = [];
  const build = (evaluate: (c: any) => Partial<NavigationGuidance>) =>
    new ForegroundNavigationController({
      location: {
        watch: (success) => {
          push = success;
          return 0;
        },
        clearWatch: () => {},
      },
      clock: { now: () => now, setInterval: () => 1, clearInterval: () => {} },
      storage: new ActiveRideStore(storage),
      evaluate: async (_route, _fix, context) => {
        seen.push(context);
        return {
          routeProgressMeters: 120,
          distanceFromRouteMeters: 2,
          instruction: "Continue",
          remainingMeters: 800,
          ...evaluate(context),
        } as NavigationGuidance;
      },
    });
  const fix = async () => {
    now += 5000;
    push({ latitude: 40, longitude: -89, accuracy: 10, timestamp: now });
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  void options;
  return { storage, values, build, fix, seen };
}

test("ridden progress is stored apart from the matched position and restored from there", async () => {
  const f = persistedRide();
  const first = f.build(() => ({ routeProgressMeters: 120, ridden: 300 }));
  first.start(record("ExerciseLoop"));
  await f.fix();
  const stored = JSON.parse([...f.values.values()][0]);
  // The rider rode about 300 m, then an off-route fix projected back onto 120 m: both are kept, distinctly.
  assert.equal(stored.routeProgressMeters, 120);
  assert.equal(stored.riddenMeters, 300);
  first.dispose();

  const restored = f.build(() => ({}));
  assert.equal(restored.restore()?.key, "route-ExerciseLoop");
  assert.equal(restored.state.routeProgressMeters, 120);
  assert.equal(restored.state.riddenMeters, 300, "not the matched position");
  await f.fix();
  assert.equal(
    f.seen.at(-1)!.previousRidden,
    300,
    "the router is given the saved ridden progress",
  );
});

test("a ride saved before ridden progress was kept restores conservatively: never more than was covered", async () => {
  const { storage } = memory();
  const store = new ActiveRideStore(storage);
  const legacy = {
    version: 1 as const,
    record: record("ExerciseLoop"),
    routeProgressMeters: 900,
    creditedDistanceMeters: 250,
    updatedAt: NOW,
  };
  store.write(legacy);
  const controller = new ForegroundNavigationController({
    storage: store,
    clock: { now: () => NOW, setInterval: () => 1, clearInterval: () => {} },
    evaluate: async () => ({}) as NavigationGuidance,
  });
  controller.restore();
  // The matched progress may have been inflated by an off-route projection; the observed distance cannot have been.
  assert.equal(controller.state.riddenMeters, 250);
  assert.equal(controller.state.routeProgressMeters, 900);
  const lessProgress = new ActiveRideStore(memory().storage);
  lessProgress.write({ ...legacy, routeProgressMeters: 100 });
  const other = new ForegroundNavigationController({
    storage: lessProgress,
    clock: { now: () => NOW, setInterval: () => 1, clearInterval: () => {} },
    evaluate: async () => ({}) as NavigationGuidance,
  });
  other.restore();
  assert.equal(other.state.riddenMeters, 100);
});

test("a stored ride with an invalid ridden value is unreadable rather than trusted", () => {
  const { storage, values } = memory();
  const store = new ActiveRideStore(storage);
  store.write({
    version: 1,
    record: record("ExerciseLoop"),
    routeProgressMeters: 10,
    riddenMeters: 5,
    creditedDistanceMeters: 10,
    updatedAt: NOW,
  });
  assert.equal(store.read().ok, true);
  const key = [...values.keys()][0];
  for (const bad of [-1, "5", null, Infinity]) {
    const copy = JSON.parse(values.get(key)!);
    copy.riddenMeters = bad;
    values.set(key, JSON.stringify(copy));
    assert.equal(
      store.read().ok,
      false,
      `riddenMeters ${String(bad)} is refused`,
    );
  }
});
