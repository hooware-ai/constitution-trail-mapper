import test from "node:test";
import assert from "node:assert/strict";
import {
  ForegroundNavigationController,
  usableFix,
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
  draft: {},
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
    advance(ms: number) {
      now += ms;
      timer?.();
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
test("location accuracy and age gates are inclusive at 35m/15s, future tolerance 5s", () => {
  const fix = {
    latitude: 40,
    longitude: -89,
    accuracy: 35,
    timestamp: NOW - 15000,
  };
  assert.equal(usableFix(fix, NOW), true);
  assert.equal(usableFix({ ...fix, accuracy: 35.1 }, NOW), false);
  assert.equal(usableFix({ ...fix, timestamp: NOW - 15001 }, NOW), false);
  assert.equal(usableFix({ ...fix, timestamp: NOW + 5000 }, NOW), true);
  assert.equal(usableFix({ ...fix, timestamp: NOW + 5001 }, NOW), false);
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
  f.advance(15_001);
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
  await f.fix(100, { accuracy: 35 }, 60);
  assert.equal(f.controller.state.phase, "navigating");
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
