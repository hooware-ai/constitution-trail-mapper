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
