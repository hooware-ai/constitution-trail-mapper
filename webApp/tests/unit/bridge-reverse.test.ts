import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// "Reverse direction" through the REAL shared Kotlin core: the same loop ridden the other way, as native does it.
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
  const module: any = await import(pathToFileURL(corePath).href + "?reverse=1");
  const call = (request: unknown) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  const trails = readFileSync(
    join(process.cwd(), "src", "data", "review-network.json"),
    "utf8",
  );
  const init = call({
    op: "initialize",
    trails,
    trustSerializedRoutes: true,
    now: NOW,
  });
  assert.equal(init.ok, true);
  return call;
}

const ends = (route: any) => {
  const first = route.segments[0].points[0];
  const lastSegment = route.segments[route.segments.length - 1];
  return { first, last: lastSegment.points[lastSegment.points.length - 1] };
};

test(
  "a loop ridden in reverse is the same loop backwards, and reversing twice restores it",
  { skip },
  () => {
    const call = engine();
    return call.then((dispatch: any) => {
      const loop = dispatch({
        op: "plan",
        start: east,
        miles: 5,
        proposed: false,
        now: NOW,
      });
      assert.equal(loop.ok, true);
      const reversed = dispatch({ op: "reverse", route: loop.route, now: NOW });
      assert.equal(reversed.ok, true);
      // Same distance and kind; start and finish swap; every segment's geometry is reversed.
      assert.equal(reversed.route.kind, "ExerciseLoop");
      assert.equal(
        reversed.route.totalDistanceMeters,
        loop.route.totalDistanceMeters,
      );
      assert.deepEqual(ends(reversed.route).first, ends(loop.route).last);
      assert.deepEqual(ends(reversed.route).last, ends(loop.route).first);
      assert.deepEqual(
        reversed.route.segments.map((s: any) => s.points),
        [...loop.route.segments]
          .reverse()
          .map((s: any) => [...s.points].reverse()),
      );
      assert.notDeepEqual(reversed.route.segments, loop.route.segments);
      // It is described afresh, so it can be navigated exactly when the loop could be, with its own instructions.
      assert.equal(reversed.canNavigate, loop.canNavigate);
      assert.ok(
        Array.isArray(reversed.instructions) &&
          reversed.instructions.length > 0,
      );
      // The reversed geometry is verified against the loaded network like any route (orientation does not matter).
      assert.equal(reversed.network.status, "current");
      const again = dispatch({
        op: "reverse",
        route: reversed.route,
        now: NOW,
      });
      assert.deepEqual(again.route.segments, loop.route.segments);
      assert.deepEqual(again.route.edges, loop.route.edges);
    });
  },
);

test("only an exercise loop can be reversed", { skip }, async () => {
  const dispatch = await engine();
  const pair = dispatch({
    op: "plan",
    start: west,
    destination: east,
    proposed: false,
    now: NOW,
  });
  assert.equal(pair.ok, true);
  const refused = dispatch({ op: "reverse", route: pair.route, now: NOW });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Only an exercise loop can be ridden in reverse/);
});
