import test from "node:test";
import assert from "node:assert/strict";
import {
  ForegroundNavigationController,
  NAVIGATION_MAX_FIX_ACCURACY_METERS,
  NAVIGATION_MAX_FIX_AGE_MS,
  navigableFix,
  type LocationFix,
  type LocationFailure,
  type LocationPort,
  type NavigationClock,
  type NavigationGuidance,
} from "../../src/platform/navigation";
import {
  ForegroundWakeLock,
  type WakeLockHandle,
} from "../../src/platform/wakeLock";
import {
  ActiveRideStore,
  type RouteRecord,
  type StoragePort,
} from "../../src/platform/storage";
const NOW = 2_000_000_000_000;
const record: RouteRecord = {
  key: "route",
  title: "A trail route",
  createdAt: NOW,
  usedAt: NOW,
  route: {},
  draft: {
    mode: "point",
    start: null,
    destination: null,
    miles: 5,
    proposed: false,
  },
};
const flush = async () => {
  for (let index = 0; index < 5; index++) await Promise.resolve();
};
function fixture() {
  let now = NOW;
  let timer: (() => void) | undefined;
  const callbacks: Array<{
    success: (fix: LocationFix) => void;
    failure: (error: LocationFailure) => void;
  }> = [];
  const cleared: number[] = [];
  const location: LocationPort = {
    watch: (success, failure) => {
      callbacks.push({ success, failure });
      return callbacks.length - 1;
    },
    clearWatch: (id) => {
      cleared.push(id);
    },
  };
  const clock: NavigationClock = {
    now: () => now,
    setInterval: (callback) => {
      timer = callback;
      return 1;
    },
    clearInterval: () => {
      timer = undefined;
    },
  };
  let progress = 0;
  let offset = 0;
  const values = new Map<string, string>();
  const storage: StoragePort = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  const controller = new ForegroundNavigationController({
    location,
    clock,
    storage: new ActiveRideStore(storage),
    evaluate: async () => ({
      routeProgressMeters: progress,
      distanceFromRouteMeters: offset,
      instruction: "Continue",
      remainingMeters: 1000 - progress,
    }),
  });
  return {
    controller,
    clock,
    location,
    storage,
    callbacks,
    cleared,
    /** Moves the clock; `tick: false` leaves the expiry timer for later, as a busy page would. */
    advance(ms: number, tick = true) {
      now += ms;
      if (tick) timer?.();
    },
    async fix(next: number, options: Partial<LocationFix> = {}, off = 0) {
      progress = next;
      offset = off;
      callbacks.at(-1)!.success({
        latitude: 40,
        longitude: -89,
        accuracy: 10,
        timestamp: now,
        ...options,
      });
      await flush();
    },
    now: () => now,
  };
}
test("navigation accepts exactly the shared core's credible fixes: accuracy <= 25 m, age 0..10 s, never future", () => {
  assert.equal(NAVIGATION_MAX_FIX_ACCURACY_METERS, 25);
  assert.equal(NAVIGATION_MAX_FIX_AGE_MS, 10_000);
  const fix = {
    latitude: 40,
    longitude: -89,
    accuracy: 25,
    timestamp: NOW - 10_000,
  };
  assert.equal(navigableFix(fix, NOW), true);
  assert.equal(navigableFix({ ...fix, timestamp: NOW }, NOW), true);
  for (const accuracy of [25.01, 26, 35])
    assert.equal(navigableFix({ ...fix, accuracy }, NOW), false, `${accuracy}`);
  assert.equal(navigableFix({ ...fix, timestamp: NOW - 10_001 }, NOW), false);
  assert.equal(navigableFix({ ...fix, timestamp: NOW - 11_000 }, NOW), false);
  assert.equal(navigableFix({ ...fix, timestamp: NOW + 1 }, NOW), false);
  assert.equal(navigableFix({ ...fix, timestamp: NOW + 5_000 }, NOW), false);
  for (const invalid of [
    { latitude: Number.NaN },
    { latitude: 91 },
    { longitude: -181 },
    { accuracy: -1 },
    { timestamp: Number.NaN },
  ])
    assert.equal(navigableFix({ ...fix, ...invalid }, NOW), false);
});
test("controller guides on a 25 m fix, loses guidance on 26 m and 35 m with 25 m recovery copy, and recovers without unseen credit", async () => {
  const f = fixture();
  f.controller.start(record);
  await f.fix(100, { accuracy: 25 });
  assert.equal(f.controller.state.phase, "navigating");
  assert.equal(f.controller.state.guidance?.instruction, "Continue");
  f.advance(1000);
  await f.fix(150, { accuracy: 25 });
  assert.equal(f.controller.state.creditedDistanceMeters, 50);
  for (const accuracy of [26, 35]) {
    f.advance(1000);
    await f.fix(200, { accuracy });
    assert.equal(f.controller.state.phase, "location-lost", `${accuracy}`);
    assert.equal(f.controller.state.guidance, null);
    assert.equal(f.controller.state.fix, null);
    assert.equal(
      f.controller.state.message,
      "Waiting for a fresh location with accuracy within 25 m.",
    );
  }
  f.advance(1000);
  await f.fix(400, { accuracy: 5 });
  assert.equal(f.controller.state.phase, "navigating");
  assert.equal(f.controller.state.creditedDistanceMeters, 50);
  f.advance(1000);
  await f.fix(420, { accuracy: 5 });
  assert.equal(f.controller.state.creditedDistanceMeters, 70);
});
test("controller accepts a fix aged exactly 10 s, rejects 11 s and future-dated fixes, and expires after 10 s", async () => {
  // A fix taken when the watch started and delivered 10 s later is still credible.
  const inclusive = fixture();
  inclusive.controller.start(record);
  inclusive.advance(10_000);
  assert.equal(inclusive.controller.state.phase, "reacquiring");
  await inclusive.fix(100, { timestamp: NOW });
  assert.equal(inclusive.controller.state.phase, "navigating");
  // The expiry timer agrees: still current at exactly 10 s, lost one second later.
  inclusive.advance(1000);
  assert.equal(inclusive.controller.state.phase, "location-lost");
  assert.equal(inclusive.controller.state.guidance, null);
  // The same watch-start fix delivered 11 s later is not.
  const late = fixture();
  late.controller.start(record);
  late.advance(9_000);
  assert.equal(late.controller.state.phase, "reacquiring");
  late.advance(2_000);
  assert.equal(late.controller.state.phase, "location-lost");
  await late.fix(100, { timestamp: NOW });
  assert.equal(late.controller.state.phase, "location-lost");
  assert.equal(late.controller.state.guidance, null);
  assert.match(late.controller.state.message, /within 25 m/);
  // Future-dated readings are refused, then a current one recovers.
  const future = fixture();
  future.controller.start(record);
  await future.fix(100, { timestamp: NOW + 1 });
  assert.equal(future.controller.state.phase, "location-lost");
  assert.equal(future.controller.state.guidance, null);
  future.advance(1);
  await future.fix(100);
  assert.equal(future.controller.state.phase, "navigating");
});
test("a worker answer arriving after its fix aged past 10 s is discarded; one at exactly 10 s is adopted", async () => {
  for (const [delay, adopted] of [
    [10_000, true],
    [10_001, false],
  ] as const) {
    const f = fixture();
    const resolves: Array<(value: NavigationGuidance) => void> = [];
    const controller = new ForegroundNavigationController({
      location: f.location,
      clock: f.clock,
      evaluate: () => new Promise((resolve) => resolves.push(resolve)),
    });
    controller.start(record);
    f.callbacks
      .at(-1)!
      .success({ latitude: 40, longitude: -89, accuracy: 25, timestamp: NOW });
    // The worker is slow; the expiry timer has not ticked yet.
    f.advance(delay, false);
    resolves[0]({
      routeProgressMeters: 100,
      distanceFromRouteMeters: 0,
      instruction: "Late",
      remainingMeters: 900,
    });
    await flush();
    assert.equal(controller.state.phase === "navigating", adopted, `${delay}`);
    assert.equal(
      controller.state.guidance?.instruction ?? null,
      adopted ? "Late" : null,
    );
  }
});
test("a reroute request and its applicability follow the 10 s freshness rule", async () => {
  const { f, request } = await offRoute();
  f.advance(10_000, false);
  assert.equal(f.controller.rerouteStaleReason(request), null);
  assert.ok(f.controller.rerouteRequest());
  f.advance(1, false);
  assert.equal(f.controller.rerouteStaleReason(request), "location-lost");
  assert.equal(f.controller.rerouteRequest(), null);
  // The next timer tick then drops guidance, which also interrupts the request.
  f.advance(0);
  assert.equal(f.controller.state.phase, "location-lost");
  assert.equal(f.controller.rerouteStaleReason(request), "interrupted");
});
test("hide immediately clears guidance and watch; resume earns no distance for unseen movement", async () => {
  const f = fixture();
  f.controller.start(record);
  assert.equal(f.controller.state.phase, "reacquiring");
  await f.fix(100);
  f.advance(5000);
  await f.fix(120);
  assert.equal(f.controller.state.creditedDistanceMeters, 20);
  f.controller.setVisible(false);
  assert.equal(f.controller.state.phase, "paused");
  assert.equal(f.controller.state.guidance, null);
  assert.deepEqual(f.cleared, [0]);
  f.advance(60_000);
  f.controller.setVisible(true);
  assert.equal(f.controller.state.phase, "reacquiring");
  await f.fix(700);
  assert.equal(f.controller.state.creditedDistanceMeters, 20);
  f.advance(5000);
  await f.fix(710);
  assert.equal(f.controller.state.creditedDistanceMeters, 30);
});
test("reload restores route/progress in reacquiring state without cached instruction or distance credit", async () => {
  const f = fixture();
  f.controller.start(record);
  await f.fix(100);
  f.advance(5000);
  await f.fix(120);
  f.controller.dispose();
  const restored = new ForegroundNavigationController({
    location: f.location,
    clock: f.clock,
    storage: new ActiveRideStore(f.storage),
    evaluate: async () => ({
      routeProgressMeters: 600,
      distanceFromRouteMeters: 0,
      instruction: "Continue",
      remainingMeters: 400,
    }),
  });
  assert.equal(restored.restore()?.key, "route");
  assert.equal(restored.state.phase, "reacquiring");
  assert.equal(restored.state.guidance, null);
  assert.equal(restored.state.creditedDistanceMeters, 20);
  f.callbacks.at(-1)!.success({
    latitude: 40,
    longitude: -89,
    accuracy: 10,
    timestamp: f.now(),
  });
  await flush();
  assert.equal(restored.state.creditedDistanceMeters, 20);
});
test("timeout and inaccurate fixes immediately remove guidance, next good fix establishes a new baseline", async () => {
  const f = fixture();
  f.controller.start(record);
  await f.fix(100);
  f.advance(10_000);
  assert.equal(f.controller.state.phase, "navigating");
  f.advance(1);
  assert.equal(f.controller.state.phase, "location-lost");
  assert.equal(f.controller.state.guidance, null);
  await f.fix(500);
  assert.equal(f.controller.state.creditedDistanceMeters, 0);
  f.advance(1000);
  await f.fix(600, { accuracy: 100 });
  assert.equal(f.controller.state.guidance, null);
  f.advance(1000);
  await f.fix(700);
  assert.equal(f.controller.state.creditedDistanceMeters, 0);
});
test("old watch callbacks and cached pre-resume locations cannot resurrect stale guidance", async () => {
  const f = fixture();
  f.controller.start(record);
  await f.fix(0);
  const old = f.callbacks[0];
  f.controller.setVisible(false);
  f.advance(1000);
  f.controller.setVisible(true);
  old.success({
    latitude: 40,
    longitude: -89,
    accuracy: 10,
    timestamp: f.now(),
  });
  await flush();
  assert.equal(f.controller.state.guidance, null);
  await f.fix(1, { timestamp: NOW });
  assert.equal(f.controller.state.guidance, null);
  await f.fix(2);
  assert.equal(f.controller.state.phase, "navigating");
});
test("off-route requires accurate, consecutive fixes separated by four seconds; on-route fix resets suspicion", async () => {
  const f = fixture();
  f.controller.start(record);
  await f.fix(100, {}, 100);
  assert.equal(f.controller.state.phase, "navigating");
  assert.equal(f.controller.state.guidance, null);
  f.advance(3000);
  await f.fix(100, {}, 100);
  assert.notEqual(f.controller.state.phase, "off-route");
  f.advance(1000);
  await f.fix(100, {}, 100);
  assert.equal(f.controller.state.phase, "off-route");
  f.advance(1000);
  await f.fix(100);
  assert.equal(f.controller.state.phase, "navigating");
  f.advance(1000);
  // The fallback tolerance widens with accuracy: max(45, 2 × 25 m) = 50 m.
  await f.fix(100, { accuracy: 25 }, 49);
  assert.equal(f.controller.state.phase, "navigating");
  assert.notEqual(f.controller.state.guidance, null);
});
test("stale worker completion after hide is ignored", async () => {
  const f = fixture();
  const resolves: Array<(value: NavigationGuidance) => void> = [];
  const controller = new ForegroundNavigationController({
    location: f.location,
    clock: f.clock,
    evaluate: () => new Promise((resolve) => resolves.push(resolve)),
  });
  controller.start(record);
  f.callbacks
    .at(-1)!
    .success({ latitude: 40, longitude: -89, accuracy: 10, timestamp: NOW });
  controller.setVisible(false);
  resolves[0]({
    routeProgressMeters: 100,
    distanceFromRouteMeters: 0,
    instruction: "Stale",
    remainingMeters: 10,
  });
  await flush();
  assert.equal(controller.state.phase, "paused");
  assert.equal(controller.state.guidance, null);
});
test("permission denial is explicit and stop clears recovery state", async () => {
  const f = fixture();
  f.controller.start(record);
  f.callbacks[0].failure({ code: 1 });
  assert.equal(f.controller.state.phase, "permission-denied");
  assert.equal(f.controller.state.guidance, null);
  f.advance(20000);
  assert.equal(f.controller.state.phase, "permission-denied");
  f.controller.stop();
  assert.equal(new ActiveRideStore(f.storage).read().state, null);
});
function handle(): WakeLockHandle & { releases: number } {
  const h = {
    released: false,
    releases: 0,
    async release() {
      h.released = true;
      h.releases++;
    },
    addEventListener() {},
  };
  return h;
}
test("wake lock reports unsupported/denied, releases when hidden, reacquires when visible", async () => {
  const unsupported = new ForegroundWakeLock();
  unsupported.setActive(true);
  assert.equal(unsupported.status, "unsupported");
  const denied = new ForegroundWakeLock({
    request: async () => {
      throw new Error("denied");
    },
  });
  denied.setActive(true);
  await flush();
  assert.equal(denied.status, "denied");
  const handles: ReturnType<typeof handle>[] = [];
  const wake = new ForegroundWakeLock({
    request: async () => {
      const next = handle();
      handles.push(next);
      return next;
    },
  });
  wake.setActive(true);
  await flush();
  assert.equal(wake.status, "held");
  wake.setVisible(false);
  await flush();
  assert.equal(handles[0].releases, 1);
  assert.equal(wake.status, "inactive");
  wake.setVisible(true);
  await flush();
  assert.equal(wake.status, "held");
  assert.equal(handles.length, 2);
  wake.dispose();
  await flush();
  assert.equal(handles[1].releases, 1);
});
test("late wake lock grant after stop is immediately released", async () => {
  let resolve!: (value: WakeLockHandle) => void;
  const wake = new ForegroundWakeLock({
    request: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  wake.setActive(true);
  wake.setActive(false);
  const granted = handle();
  resolve(granted);
  await flush();
  assert.equal(granted.releases, 1);
  assert.equal(wake.status, "inactive");
});

test("newest worker snapshot wins when older evaluation resolves last", async () => {
  const f = fixture();
  const resolves: Array<(value: NavigationGuidance) => void> = [];
  const controller = new ForegroundNavigationController({
    location: f.location,
    clock: f.clock,
    evaluate: () => new Promise((resolve) => resolves.push(resolve)),
  });
  controller.start(record);
  const success = f.callbacks.at(-1)!.success;
  success({ latitude: 40, longitude: -89, accuracy: 10, timestamp: NOW });
  f.advance(1000);
  success({ latitude: 40, longitude: -89, accuracy: 10, timestamp: f.now() });
  resolves[1]({
    routeProgressMeters: 200,
    distanceFromRouteMeters: 0,
    instruction: "New",
    remainingMeters: 800,
  });
  await flush();
  resolves[0]({
    routeProgressMeters: 100,
    distanceFromRouteMeters: 0,
    instruction: "Old",
    remainingMeters: 900,
  });
  await flush();
  assert.equal(controller.state.guidance?.instruction, "New");
  assert.equal(controller.state.routeProgressMeters, 200);
});
test("synchronous geolocation failure stays recoverable without an uncaught exception", () => {
  const controller = new ForegroundNavigationController({
    location: {
      watch: () => {
        throw new Error("unavailable");
      },
      clearWatch() {},
    },
    evaluate: async () => {
      throw new Error("not called");
    },
  });
  assert.doesNotThrow(() => controller.start(record));
  assert.equal(controller.state.phase, "location-lost");
  controller.stop();
});
test("continuous credible off-route fixes retain native deviation state without repeated reacquisition", async () => {
  const f = fixture();
  const resumes: boolean[] = [];
  const controller = new ForegroundNavigationController({
    location: f.location,
    clock: f.clock,
    evaluate: async (_route, _fix, context) => {
      resumes.push(context.resume);
      return {
        routeProgressMeters: 100,
        distanceFromRouteMeters: 100,
        instruction: "Continue",
        remainingMeters: 900,
        offRoute: resumes.length >= 3,
      };
    },
  });
  controller.start(record);
  for (let index = 0; index < 3; index++) {
    if (index) f.advance(8000);
    f.callbacks.at(-1)!.success({
      latitude: 40,
      longitude: -89,
      accuracy: 10,
      timestamp: f.now(),
    });
    await flush();
  }
  assert.deepEqual(resumes, [true, false, false]);
  assert.equal(controller.state.phase, "off-route");
  assert.equal(controller.state.creditedDistanceMeters, 0);
});
test("native deviation status overrides generic fallback and accepted hook rejects stale results", async () => {
  const f = fixture();
  let accepts = 0;
  const controller = new ForegroundNavigationController({
    location: f.location,
    clock: f.clock,
    onAccepted: () => {
      accepts++;
    },
    evaluate: async () => ({
      routeProgressMeters: 100,
      distanceFromRouteMeters: 100,
      instruction: "Continue",
      remainingMeters: 900,
      offRoute: false,
    }),
  });
  controller.start(record);
  f.callbacks.at(-1)!.success({
    latitude: 40,
    longitude: -89,
    accuracy: 10,
    timestamp: f.now(),
  });
  await flush();
  f.advance(5000);
  f.callbacks.at(-1)!.success({
    latitude: 40,
    longitude: -89,
    accuracy: 10,
    timestamp: f.now(),
  });
  await flush();
  assert.equal(controller.state.phase, "navigating");
  assert.equal(accepts, 2);
  f.advance(1000);
  f.callbacks.at(-1)!.success({
    latitude: 40,
    longitude: -89,
    accuracy: 10,
    timestamp: f.now(),
  });
  controller.setVisible(false);
  await flush();
  assert.equal(accepts, 2);
});

test("routing becoming unavailable clears guidance immediately but keeps route, progress and credit, and needs a fresh evaluation", async () => {
  const f = fixture();
  f.controller.start(record);
  await f.fix(100);
  f.advance(5000);
  await f.fix(140);
  assert.equal(f.controller.state.phase, "navigating");
  const credited = f.controller.state.creditedDistanceMeters;
  f.controller.routingUnavailable();
  const lost = f.controller.state;
  assert.equal(lost.phase, "location-lost");
  assert.equal(lost.guidance, null);
  assert.match(lost.message, /Restart route planning/);
  assert.equal(lost.record?.key, "route");
  assert.equal(lost.routeProgressMeters, 140);
  assert.equal(lost.creditedDistanceMeters, credited);
  // Recovery does not resume by itself: only a fresh accepted evaluation does, without crediting the gap.
  f.advance(1000);
  await f.fix(500);
  assert.equal(f.controller.state.phase, "navigating");
  assert.equal(f.controller.state.creditedDistanceMeters, credited);
});
test("routing unavailability with no ride is ignored", () => {
  const f = fixture();
  f.controller.routingUnavailable();
  assert.equal(f.controller.state.phase, "idle");
});

async function offRoute() {
  const f = fixture();
  f.controller.start(record);
  await f.fix(100);
  f.advance(1000);
  await f.fix(100, {}, 120);
  f.advance(5000);
  await f.fix(100, {}, 120);
  assert.equal(f.controller.state.phase, "off-route");
  const request = f.controller.rerouteRequest();
  assert.ok(request);
  return { f, request };
}
test("a reroute request only exists while confirmed off route with a credible fix", async () => {
  const f = fixture();
  f.controller.start(record);
  assert.equal(f.controller.rerouteRequest(), null);
  await f.fix(100);
  assert.equal(f.controller.rerouteRequest(), null);
  const { request } = await offRoute();
  assert.equal(request.recordKey, "route");
});
test("a reroute result still applies after ordinary accepted fixes near the request point", async () => {
  const { f, request } = await offRoute();
  f.advance(1000);
  await f.fix(100, { latitude: 40.0001 }, 120);
  assert.equal(f.controller.rerouteStaleReason(request), null);
});
test("location loss, hide/show and a restarted ride each invalidate a delayed reroute", async () => {
  for (const interrupt of [
    (f: ReturnType<typeof fixture>) => f.callbacks.at(-1)!.failure({ code: 2 }),
    (f: ReturnType<typeof fixture>) => {
      f.controller.setVisible(false);
      f.controller.setVisible(true);
    },
    (f: ReturnType<typeof fixture>) => f.controller.start(record),
  ]) {
    const { f, request } = await offRoute();
    interrupt(f);
    assert.notEqual(f.controller.rerouteStaleReason(request), null);
  }
});
test("a stopped or replaced ride never adopts a reroute made for the previous one", async () => {
  const stopped = await offRoute();
  stopped.f.controller.stop();
  assert.equal(
    stopped.f.controller.rerouteStaleReason(stopped.request),
    "ride-changed",
  );
  const replaced = await offRoute();
  replaced.f.controller.start({ ...record, key: "other" });
  assert.equal(
    replaced.f.controller.rerouteStaleReason(replaced.request),
    "ride-changed",
  );
});
test("a reroute is rejected once the rider rejoined the route or moved materially", async () => {
  const rejoined = await offRoute();
  rejoined.f.advance(1000);
  await rejoined.f.fix(110, {}, 0);
  assert.equal(
    rejoined.f.controller.rerouteStaleReason(rejoined.request),
    "interrupted",
  );
  const moved = await offRoute();
  moved.f.advance(1000);
  await moved.f.fix(100, { latitude: 40.002 }, 120);
  assert.equal(moved.f.controller.rerouteStaleReason(moved.request), "moved");
});
test("an aged-out fix loses location and invalidates a delayed reroute", async () => {
  const { f, request } = await offRoute();
  f.advance(20_000);
  assert.equal(f.controller.rerouteStaleReason(request), "interrupted");
});

test("a request cannot revive after off route, back on route and off route again nearby", async () => {
  const { f, request } = await offRoute();
  f.advance(1000);
  await f.fix(110, { latitude: 40.0001 }, 0);
  assert.equal(f.controller.state.phase, "navigating");
  assert.notEqual(f.controller.rerouteStaleReason(request), null);
  // Depart again close to where the request was made and confirm a new episode.
  f.advance(1000);
  await f.fix(110, { latitude: 40.0001 }, 120);
  f.advance(5000);
  await f.fix(110, { latitude: 40.0001 }, 120);
  assert.equal(f.controller.state.phase, "off-route");
  assert.equal(f.controller.rerouteStaleReason(request), "interrupted");
  // A request made for the new episode is valid, and ordinary nearby fixes keep it valid.
  const fresh = f.controller.rerouteRequest()!;
  f.advance(1000);
  await f.fix(110, { latitude: 40.0002 }, 120);
  assert.equal(f.controller.rerouteStaleReason(fresh), null);
});
test("a newer fix waiting for evaluation is settled before a reroute is judged", async () => {
  const f = fixture();
  let hold: ((distance: number) => void) | null = null;
  let offset = 120;
  const controller = new ForegroundNavigationController({
    location: f.location,
    clock: f.clock,
    evaluate: () =>
      hold
        ? new Promise((resolve) => {
            const release = hold as unknown as null;
            void release;
            hold = (distance: number) =>
              resolve({
                routeProgressMeters: 100,
                distanceFromRouteMeters: distance,
                instruction: "Continue",
                remainingMeters: 900,
              });
          })
        : Promise.resolve({
            routeProgressMeters: 100,
            distanceFromRouteMeters: offset,
            instruction: "Continue",
            remainingMeters: 900,
          }),
  });
  const deliver = async (latitude: number) => {
    f.callbacks.at(-1)!.success({
      latitude,
      longitude: -89,
      accuracy: 10,
      timestamp: f.now(),
    });
    await flush();
  };
  controller.start(record);
  await deliver(40);
  f.advance(5000);
  await deliver(40);
  assert.equal(controller.state.phase, "off-route");
  const request = controller.rerouteRequest()!;
  // A newer fix ~222 m away is queued behind the reroute, not yet evaluated.
  hold = () => {};
  f.advance(1000);
  await deliver(40.002);
  assert.equal(controller.rerouteStaleReason(request), null);
  let settled: boolean | undefined;
  const waiting = controller.whenEvaluationsSettled().then((value) => {
    settled = value;
  });
  await flush();
  assert.equal(settled, undefined);
  hold(120);
  await waiting;
  assert.equal(settled, true);
  assert.equal(controller.rerouteStaleReason(request), "moved");
  // Variant: the queued fix shows the rider back on the route.
  const second = controller.rerouteRequest()!;
  hold = () => {};
  f.advance(1000);
  await deliver(40.002);
  const again = controller.whenEvaluationsSettled();
  hold(0);
  await again;
  assert.notEqual(controller.rerouteStaleReason(second), null);
});
test("waiting for evaluations gives up after the timeout instead of hanging", async () => {
  const f = fixture();
  const controller = new ForegroundNavigationController({
    location: f.location,
    clock: f.clock,
    evaluate: () => new Promise(() => {}),
  });
  controller.start(record);
  f.callbacks.at(-1)!.success({
    latitude: 40,
    longitude: -89,
    accuracy: 10,
    timestamp: f.now(),
  });
  await flush();
  assert.equal(await controller.whenEvaluationsSettled(10), false);
});

test("replacing the route keeps the ride's observed distance, resets route progress, persists and survives reload", async () => {
  const f = fixture();
  f.controller.start(record);
  await f.fix(100);
  f.advance(5000);
  await f.fix(300);
  assert.equal(f.controller.state.creditedDistanceMeters, 200);
  f.controller.replaceRoute({ ...record, key: "replacement" });
  assert.equal(f.controller.state.record?.key, "replacement");
  assert.equal(f.controller.state.routeProgressMeters, 0);
  assert.equal(f.controller.state.creditedDistanceMeters, 200);
  const stored = new ActiveRideStore(f.storage).read().state;
  assert.equal(stored?.record.key, "replacement");
  assert.equal(stored?.creditedDistanceMeters, 200);
  // Repeated replacements, with observed movement in between, keep accumulating the same ride's total.
  f.advance(1000);
  await f.fix(50);
  f.advance(5000);
  await f.fix(80);
  assert.equal(f.controller.state.creditedDistanceMeters, 230);
  f.controller.replaceRoute({ ...record, key: "second" });
  assert.equal(f.controller.state.creditedDistanceMeters, 230);
  // Reload restores route and the total.
  const reloaded = fixture();
  const persisted = new ActiveRideStore(f.storage).read().state!;
  reloaded.controller.start(
    persisted.record,
    persisted.routeProgressMeters,
    persisted.creditedDistanceMeters,
  );
  assert.equal(reloaded.controller.state.creditedDistanceMeters, 230);
});
test("hidden intervals and unobserved movement add no distance across a route replacement, and a new ride starts from zero", async () => {
  const f = fixture();
  f.controller.start(record);
  await f.fix(100);
  f.advance(5000);
  await f.fix(150);
  f.controller.replaceRoute({ ...record, key: "replacement" });
  f.controller.setVisible(false);
  f.advance(60_000);
  f.controller.setVisible(true);
  await f.fix(900);
  assert.equal(f.controller.state.creditedDistanceMeters, 50);
  f.controller.start({ ...record, key: "new-ride" });
  assert.equal(f.controller.state.creditedDistanceMeters, 0);
});

test("an ambiguous reacquisition shows no guidance, credits nothing and keeps reacquiring", async () => {
  let ambiguous = true;
  const f = fixture();
  const controller = new ForegroundNavigationController({
    location: f.location,
    clock: f.clock,
    evaluate: async () => ({
      routeProgressMeters: 3200,
      distanceFromRouteMeters: 0,
      instruction: "Turn around",
      remainingMeters: 800,
      ambiguous,
    }),
  });
  controller.start(record, 3200, 50);
  f.callbacks.at(-1)!.success({
    latitude: 40,
    longitude: -89,
    accuracy: 10,
    timestamp: f.now(),
  });
  await flush();
  assert.equal(controller.state.phase, "reacquiring");
  assert.equal(controller.state.guidance, null);
  assert.match(
    controller.state.message,
    /can't tell where you are on the loop/,
  );
  assert.equal(controller.state.creditedDistanceMeters, 50);
  assert.equal(controller.state.routeProgressMeters, 3200);
  // A later clear position resumes guidance, still without crediting the unobserved gap.
  ambiguous = false;
  f.advance(1000);
  f.callbacks.at(-1)!.success({
    latitude: 40,
    longitude: -89,
    accuracy: 10,
    timestamp: f.now(),
  });
  await flush();
  assert.equal(controller.state.phase, "navigating");
  assert.equal(controller.state.creditedDistanceMeters, 50);
});
