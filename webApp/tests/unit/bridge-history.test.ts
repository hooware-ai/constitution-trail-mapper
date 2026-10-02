import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Completed-ride history through the REAL shared Kotlin core: the session a finished loop leaves, what a rejoin carries,
// and the effect on the next loop (recently ridden edges cost more, as in native).
const corePath = join(
  resolve(process.cwd(), ".."),
  "webBridge",
  "build",
  "dist",
  "js",
  "productionLibrary",
  "TrailMapper-webBridge.mjs",
);
const skip = existsSync(corePath)
  ? false
  : "the Kotlin core is not built (npm run build:core)";
const NOW = Date.parse("2026-10-01T15:00:00Z");
const east = { latitude: 40.51, longitude: -88.95 };
const west = { latitude: 40.49, longitude: -88.99 };

async function engine() {
  const module: any = await import(pathToFileURL(corePath).href + "?history=1");
  const call = (request: unknown) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  const trails = readFileSync(
    join(process.cwd(), "src", "data", "review-network.json"),
    "utf8",
  );
  assert.equal(
    call({ op: "initialize", trails, trustSerializedRoutes: true, now: NOW })
      .ok,
    true,
  );
  return call;
}
const keys = (result: any) =>
  JSON.stringify(result.route.traversalEdges.map((e: any) => e.key));

test(
  "a finished loop leaves a direction-independent session, and only a loop does",
  { skip },
  async () => {
    const call = await engine();
    const loop = call({
      op: "plan",
      start: east,
      miles: 3,
      proposed: false,
      now: NOW,
    });
    const made = call({
      op: "completedSession",
      route: loop.route,
      completedAt: NOW,
    });
    assert.equal(made.ok, true);
    const session = made.session;
    assert.equal(session.completedAtEpochMillis, NOW);
    assert.match(session.routeKey, /^exercise:/);
    assert.equal(session.id, `${NOW}:${session.routeKey}`);
    assert.equal(
      session.completedDistanceMeters,
      loop.route.totalDistanceMeters,
    );
    assert.equal(
      session.traversalEdges.length,
      loop.route.traversalEdges.length,
    );
    // The same loop ridden the other way is the same history key.
    const reversed = call({ op: "reverse", route: loop.route, now: NOW });
    const back = call({
      op: "completedSession",
      route: reversed.route,
      completedAt: NOW,
    });
    assert.equal(back.session.routeKey, session.routeKey);
    // A point-to-point route leaves nothing, and a negative time is refused rather than recorded.
    const pair = call({
      op: "plan",
      start: west,
      destination: east,
      proposed: false,
      now: NOW,
    });
    assert.equal(
      call({ op: "completedSession", route: pair.route, completedAt: NOW })
        .session,
      null,
    );
    assert.equal(
      call({ op: "completedSession", route: loop.route, completedAt: -1 })
        .session,
      null,
    );
  },
);

test(
  "a rejoin carries what was ridden, and the finished ride counts all of it",
  { skip },
  async () => {
    const call = await engine();
    const loop = call({
      op: "plan",
      start: east,
      miles: 3,
      proposed: false,
      now: NOW,
    });
    const carried = call({
      op: "carryRide",
      route: loop.route,
      progress: 1200,
      now: NOW,
    });
    assert.equal(carried.ok, true);
    assert.ok(Math.abs(carried.carried.distanceMeters - 1200) < 5);
    assert.ok(carried.carried.traversalEdges.length > 0);
    const whole = call({
      op: "completedSession",
      route: loop.route,
      completedAt: NOW,
      carried: carried.carried,
    });
    assert.equal(
      whole.session.completedDistanceMeters,
      carried.carried.distanceMeters + loop.route.totalDistanceMeters,
    );
    assert.equal(
      whole.session.traversalEdges.length,
      carried.carried.traversalEdges.length + loop.route.traversalEdges.length,
    );
    // Carrying twice accumulates.
    const twice = call({
      op: "carryRide",
      route: loop.route,
      progress: 500,
      carried: carried.carried,
      now: NOW,
    });
    assert.ok(twice.carried.distanceMeters > carried.carried.distanceMeters);
    assert.equal(
      call({ op: "carryRide", route: loop.route, progress: -1, now: NOW }).ok,
      false,
    );
  },
);

test(
  "history makes the next loop avoid what was just ridden, and malformed history is refused",
  { skip },
  async () => {
    const call = await engine();
    const first = call({
      op: "plan",
      start: east,
      miles: 3,
      proposed: false,
      now: NOW,
    });
    const { session } = call({
      op: "completedSession",
      route: first.route,
      completedAt: NOW,
    });
    const next = call({
      op: "plan",
      start: east,
      miles: 3,
      proposed: false,
      completedSessions: [session],
      now: NOW,
    });
    assert.equal(next.ok, true);
    assert.notEqual(
      keys(next),
      keys(first),
      "a recently ridden loop is not offered again",
    );
    // Without history the same request gives the same loop as before (history is the only difference).
    assert.equal(
      keys(
        call({ op: "plan", start: east, miles: 3, proposed: false, now: NOW }),
      ),
      keys(first),
    );
    const bad = call({
      op: "plan",
      start: east,
      miles: 3,
      proposed: false,
      completedSessions: [{ id: "x" }],
      now: NOW,
    });
    assert.equal(bad.ok, false);
    const tooMany = call({
      op: "plan",
      start: east,
      miles: 3,
      proposed: false,
      completedSessions: Array.from({ length: 101 }, () => session),
      now: NOW,
    });
    assert.equal(tooMany.ok, false);
    assert.match(tooMany.error, /Too many completed exercise sessions/);
  },
);
