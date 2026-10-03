import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_WIDTH,
  PRIVATE_IMAGE_TITLE,
  PRIVACY_RADIUS_METERS,
  fitProjection,
  hideEndpoints,
  metersBetween,
  offsetToTheRight,
  planImage,
  wrapText,
  type ImageInput,
} from "../../src/shareImage";
import type { MapCuePiece, Point } from "../../src/types";

const measure = (text: string, size: number) => text.length * size * 0.5;
const line = (...pts: [number, number][]): Point[] =>
  pts.map(([latitude, longitude]) => ({ latitude, longitude }));
const piece = (
  points: Point[],
  extra: Partial<MapCuePiece> = {},
): MapCuePiece => ({
  points,
  type: "Trail",
  isRouted: true,
  roles: ["TrailBranches"],
  name: null,
  repeatsEarlierTravel: false,
  distances: points.map((_, i) => i * 100),
  ...extra,
});
// A straight 4 km northbound trail.
const long = line(
  ...[0, 0.01, 0.02, 0.03, 0.036].map(
    (d) => [40.5 + d, -88.95] as [number, number],
  ),
);
const base = (extra: Partial<ImageInput> = {}): ImageInput => ({
  title: "A loop from the East trailhead",
  summary: "Exercise loop found: 3.5 mi, about 26 min at 8 mph.",
  warnings: ["Uptown trail detour advisory: closed."],
  attribution: "Trail data: McGIS and members, CC BY 4.0.",
  pieces: [piece(long)],
  turnarounds: [
    { point: long[0], distance: 0 },
    { point: long[2], distance: 2000 },
  ],
  context: [
    line([40.52, -88.96], [40.53, -88.96]),
    line([41.5, -80], [41.6, -80]),
  ],
  exact: true,
  ...extra,
});

test("by default nothing within 300 m (plus margin) of either end is drawn, even where one long leg crosses it", () => {
  const a = long[0];
  const b = long.at(-1)!;
  // One single 4 km leg: only densifying can keep it from crossing the hidden areas whole.
  const trimmed = hideEndpoints([piece([a, b])], a, b);
  assert.ok(trimmed.length >= 1);
  for (const p of trimmed.flatMap((t) => t.points)) {
    assert.ok(metersBetween(a, p) > PRIVACY_RADIUS_METERS + 50);
    assert.ok(metersBetween(b, p) > PRIVACY_RADIUS_METERS + 50);
  }
  // A leg that passes THROUGH the middle hidden area is split in two rather than drawn across it.
  const mid = long[2];
  const split = hideEndpoints([piece([a, mid, b])], mid, mid);
  assert.ok(split.length >= 2, "the run is cut around the hidden point");
  // A route entirely inside the hidden radius leaves nothing.
  assert.deepEqual(
    hideEndpoints([piece(line([40.5, -88.95], [40.501, -88.95]))], a, a),
    [],
  );
});

test("the plan hides endpoints, markers and turnaround signs by default and shows them when approved", () => {
  const exact = planImage(base({ exact: true }), measure);
  assert.deepEqual(
    exact.markers.map((m) => m.label),
    ["Start", "Finish"],
  );
  assert.equal(exact.turnarounds.length, 2);
  const hidden = planImage(base({ exact: false }), measure);
  assert.deepEqual(hidden.markers, []);
  // The turn-around at the very start is inside the hidden area; the one 2 km in is not.
  assert.equal(hidden.turnarounds.length, 1);
  assert.ok(hidden.runs.length >= 1);
  assert.throws(
    () =>
      planImage(
        base({
          exact: false,
          pieces: [piece(line([40.5, -88.95], [40.501, -88.95]))],
        }),
        measure,
      ),
    /too short/,
  );
  assert.throws(() => planImage(base({ pieces: [] }), measure), /no route/);
  // A loop that ends where it starts is one marker.
  const loop = planImage(
    base({ pieces: [piece([...long, long[0]])] }),
    measure,
  );
  assert.deepEqual(
    loop.markers.map((m) => m.label),
    ["Start / Finish"],
  );
});

test("the picture is 1080 wide, fits the route inside its map, keeps north up, and brings only nearby trails as context", () => {
  const plan = planImage(base(), measure);
  assert.equal(plan.width, IMAGE_WIDTH);
  assert.ok(plan.height > plan.map.y + plan.map.height);
  for (const run of plan.runs)
    for (const p of run.pixels) {
      assert.ok(p.x >= plan.map.x && p.x <= plan.map.x + plan.map.width);
      assert.ok(p.y >= plan.map.y && p.y <= plan.map.y + plan.map.height);
    }
  // North is up: the end of a northbound route is higher (smaller y) than its start.
  const pixels = plan.runs[0].pixels;
  assert.ok(pixels.at(-1)!.y < pixels[0].y);
  assert.equal(
    plan.context.length,
    1,
    "the trail near the route is kept, the one a hundred kilometres away is not",
  );
  assert.ok(plan.chevrons.length > 0);
  assert.ok(plan.warnings.length === 1 && plan.attribution.length >= 1);
});

test("a second pass is drawn beside the first by a pixel offset to the right of travel, as native does", () => {
  const north = [
    { x: 100, y: 500 },
    { x: 100, y: 400 },
    { x: 100, y: 300 },
  ];
  const shifted = offsetToTheRight(north, 22);
  // Heading up the page (north), right is east: x increases by the offset, y unchanged.
  shifted.forEach((p, i) => {
    assert.ok(Math.abs(p.x - 122) < 1e-9);
    assert.equal(p.y, north[i].y);
  });
  const east = offsetToTheRight(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    10,
  );
  assert.ok(
    Math.abs(east[0].y - 10) < 1e-9,
    "heading east, right is south (down the page)",
  );
  assert.deepEqual(offsetToTheRight([{ x: 1, y: 1 }], 5), [{ x: 1, y: 1 }]);
  const plan = planImage(
    base({
      pieces: [
        piece(long),
        piece([...long].reverse(), { repeatsEarlierTravel: true }),
      ],
      turnarounds: [],
    }),
    measure,
  );
  const [first, second] = plan.runs;
  assert.ok(
    Math.abs(second.pixels[0].x - first.pixels.at(-1)!.x) > 15,
    "the second pass is not on top of the first",
  );
  assert.ok(
    plan.chevrons.some((c) => c.second) && plan.chevrons.some((c) => !c.second),
  );
});

test("text wraps within the width, and projection preserves aspect", () => {
  const lines = wrapText(
    "one two three four five six seven",
    60,
    (t) => t.length * 5,
  );
  assert.ok(lines.every((l) => l.length * 5 <= 60 || !l.includes(" ")));
  assert.equal(lines.join(" "), "one two three four five six seven");
  assert.deepEqual(
    wrapText("", 50, (t) => t.length),
    [],
  );
  assert.deepEqual(
    wrapText("unbreakableword", 3, (t) => t.length),
    ["unbreakableword"],
  );
  const project = fitProjection(
    line([0, 0], [1, 1]),
    { x: 0, y: 0, width: 400, height: 200 },
    10,
  );
  const a = project({ latitude: 0, longitude: 0 });
  const b = project({ latitude: 1, longitude: 1 });
  assert.ok(Math.abs(b.x - a.x) <= 380 && Math.abs(a.y - b.y) <= 180);
});

import { hideAround } from "../../src/shareImage";

test("private mode trims the context trails too: nothing drawn enters a hidden circle, even one trail crossing the start", () => {
  const a = long[0];
  const b = long.at(-1)!;
  // A cross trail running east-west straight through the start, and a long leg that passes through the finish area.
  const crossesStart = line(
    [a.latitude, a.longitude - 0.01],
    [a.latitude, a.longitude + 0.01],
  );
  const crossesEnd = line(
    [b.latitude - 0.02, b.longitude],
    [b.latitude + 0.02, b.longitude],
  );
  const far = line([40.52, -88.96], [40.53, -88.96]);
  const trimmed = hideAround([crossesStart, crossesEnd, far], a, b);
  for (const p of trimmed.flat()) {
    assert.ok(metersBetween(a, p) > PRIVACY_RADIUS_METERS + 50);
    assert.ok(metersBetween(b, p) > PRIVACY_RADIUS_METERS + 50);
  }
  assert.ok(
    trimmed.length >= 5,
    "each crossing trail is cut into two pieces, the far one is kept",
  );
  // Through the plan: the drawn context never enters the circles, and exact mode keeps the whole trail.
  const input = base({
    exact: false,
    context: [crossesStart, crossesEnd, far],
  });
  const plan = planImage(input, measure);
  assert.ok(plan.context.length >= 5);
  const exact = planImage(
    base({ exact: true, context: [crossesStart, crossesEnd, far] }),
    measure,
  );
  assert.equal(exact.context.length, 3);
  // The context pixels near the start are absent in private mode: no context point projects within the hidden radius.
  const startPixel = exact.markers[0].pixel;
  const metersPerPixel =
    metersBetween(a, b) /
    Math.hypot(
      exact.markers[1].pixel.x - startPixel.x,
      exact.markers[1].pixel.y - startPixel.y,
    );
  for (const p of plan.context.flat())
    assert.ok(
      Math.hypot(p.x - startPixel.x, p.y - startPixel.y) * metersPerPixel >
        PRIVACY_RADIUS_METERS * 0.8,
    );
});

test("notices and credit are never truncated: a long credit and many notices all survive into the plan", () => {
  const credit =
    Array.from({ length: 40 }, (_, i) => `credit${i}`).join(" ") +
    " https://example.test/license";
  const warnings = Array.from(
    { length: 12 },
    (_, i) => `Notice number ${i} ` + "word ".repeat(60),
  );
  const plan = planImage(base({ attribution: credit, warnings }), measure);
  assert.equal(plan.attribution.join(" "), credit);
  assert.equal(plan.warnings.length, 12);
  for (const [i, lines] of plan.warnings.entries())
    assert.equal(lines.join(" "), warnings[i].trim());
  const short = planImage(
    base({ attribution: "Short credit.", warnings: [] }),
    measure,
  );
  assert.ok(
    plan.height > short.height,
    "the picture grows to hold what it must say",
  );
});

/** Every string the plan would paint, in one list, so a leak anywhere in the picture is caught. */
const paintedText = (plan: ReturnType<typeof planImage>) => [
  ...plan.title,
  ...plan.summary,
  ...plan.warnings.flat(),
  ...plan.attribution,
  ...plan.markers.map((m) => m.label),
  ...plan.turnarounds.map((t) => t.label),
];

test("without exact approval no saved title is painted: not endpoint labels, not a loop's start label, not a rider's rename", () => {
  const titles = [
    "123 Private Home Lane to 987 Family School Drive",
    "3.5 mi loop from 123 Private Home Lane",
    "Aunt Carol's house, 4412 Maple",
  ];
  for (const title of titles) {
    const plan = planImage(base({ title, exact: false }), measure);
    const painted = paintedText(plan).join(" | ");
    assert.deepEqual(plan.title, [PRIVATE_IMAGE_TITLE]);
    for (const secret of [
      "Private Home",
      "Family School",
      "Aunt Carol",
      "Maple",
    ])
      assert.ok(!painted.includes(secret), `${secret} leaked: ${painted}`);
    // The route's public facts are still there.
    assert.match(painted, /Exercise loop found: 3\.5 mi/);
    assert.match(painted, /Uptown trail detour advisory: closed\./);
    assert.match(painted, /McGIS/);
  }
});

test("a long private title is not painted either, and the exact opt-in control does paint the saved title", () => {
  const long = "Home at 123 Private Home Lane ".repeat(8);
  const hidden = planImage(base({ title: long, exact: false }), measure);
  assert.deepEqual(hidden.title, [PRIVATE_IMAGE_TITLE]);
  const exact = planImage(
    base({ title: "123 Private Home Lane to 987 Family School Drive" }),
    measure,
  );
  assert.ok(exact.title.join(" ").includes("123 Private Home Lane"));
  // Approving the endpoints changes only the title and the ends: the notices and credit are identical.
  const again = planImage(
    base({
      title: "123 Private Home Lane to 987 Family School Drive",
      exact: false,
    }),
    measure,
  );
  assert.deepEqual(again.warnings, exact.warnings);
  assert.deepEqual(again.attribution, exact.attribution);
  assert.deepEqual(again.summary, exact.summary);
});
