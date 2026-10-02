import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Ridden progress through the REAL shared core: what a rejoin and a carried ride are measured from. As in native it
// advances only through on-route fixes in plausible forward steps; a position an off-route fix projects onto, or an
// unconfirmed jump, never counts.
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

async function setup(pair = false) {
  const module: any = await import(pathToFileURL(corePath).href + "?ridden=1");
  const call = (request: unknown) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  const trails = readFileSync(
    join(process.cwd(), "src", "data", "review-network.json"),
    "utf8",
  );
  call({ op: "initialize", trails, trustSerializedRoutes: true, now: NOW });
  const loop = pair
    ? call({
        op: "plan",
        start: { latitude: 40.49, longitude: -88.99 },
        destination: east,
        proposed: false,
        now: NOW,
      })
    : call({ op: "plan", start: east, miles: 5, proposed: false, now: NOW });
  assert.equal(loop.ok, true);
  const points: { latitude: number; longitude: number }[] =
    loop.route.segments.flatMap((s: any) => s.points);
  const along = (meters: number) => {
    let travelled = 0;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      const leg =
        Math.hypot(
          (b.longitude - a.longitude) * Math.cos((a.latitude * Math.PI) / 180),
          b.latitude - a.latitude,
        ) * 111320;
      if (travelled + leg >= meters) {
        const t = leg === 0 ? 0 : (meters - travelled) / leg;
        return {
          latitude: a.latitude + (b.latitude - a.latitude) * t,
          longitude: a.longitude + (b.longitude - a.longitude) * t,
        };
      }
      travelled += leg;
    }
    return points.at(-1)!;
  };
  let clock = NOW;
  let state: unknown;
  let progress = 0;
  const fix = (
    point: { latitude: number; longitude: number },
    resume = false,
  ) => {
    clock += 5000;
    const result = call({
      op: "snapshot",
      route: loop.route,
      point,
      accuracy: 5,
      timestamp: clock,
      progress,
      resume,
      ...(state ? { state } : {}),
      now: clock,
    });
    assert.equal(result.ok, true, result.error);
    state = result.state;
    progress = result.progress;
    return result;
  };
  return {
    loop,
    along,
    fix,
    restore: (p: number) => ((state = undefined), (progress = p)),
  };
}

test("ridden progress follows on-route forward travel", { skip }, async () => {
  const { fix, along } = await setup();
  let last = 0;
  for (const meters of [80, 160, 240, 320]) {
    const r = fix(along(meters));
    assert.ok(r.ridden >= last, "never goes backwards");
    assert.ok(
      Math.abs(r.ridden - meters) < 25,
      `ridden ${r.ridden} near ${meters}`,
    );
    last = r.ridden;
  }
});

test(
  "an off-route fix never moves ridden progress, even when it projects onto a different part of the loop",
  { skip },
  async () => {
    const { fix, along } = await setup();
    for (const meters of [80, 160, 240]) fix(along(meters));
    const before = fix(along(300)).ridden;
    // Far from the loop: its nearest point on the route is wherever it is, and it must not count as ridden.
    const away = fix({ latitude: 40.491, longitude: -88.99 });
    assert.ok(away.distanceFromRoute > 100, "the fix really is off the route");
    assert.equal(away.ridden, before);
  },
);

test(
  "a jump forward is held until it is confirmed by continued travel from where it landed (a route that is not a loop)",
  { skip },
  async () => {
    // On a loop the matcher itself refuses to jump to a far pass; on a point-to-point route it can, so the ridden rule is
    // what keeps an unconfirmed jump from counting.
    const { fix, along } = await setup(true);
    for (const meters of [80, 160, 240]) fix(along(meters));
    const before = fix(along(300)).ridden;
    const landed = fix(along(1800)); // 1.5 km ahead in one fix: far beyond a plausible step
    assert.equal(landed.ridden, before, "an unconfirmed jump does not count");
    assert.equal(fix(along(1850)).ridden, before);
    // Continued forward travel from the landing point (150 m or more) confirms it.
    const confirmed = fix(along(1990));
    assert.ok(
      confirmed.ridden > 1900,
      `confirmed jump now counts (${confirmed.ridden})`,
    );
  },
);

test(
  "a restored ride resumes ridden progress from its saved progress, not from zero",
  { skip },
  async () => {
    const { fix, along, restore } = await setup();
    restore(500);
    const first = fix(along(520));
    assert.ok(
      first.ridden >= 500,
      `resumed from the saved progress (${first.ridden})`,
    );
  },
);
