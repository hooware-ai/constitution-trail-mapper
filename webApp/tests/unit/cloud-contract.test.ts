import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  CloudRecordError,
  ENGINE_CODEC,
  LIMITS,
  buildPlaceFields,
  buildRouteFields,
  decodeEngine,
  engineMatchesRecord,
  parsePlaceRecord,
  parseRouteRecord,
  requireOwner,
  routeFieldsOf,
  toRouteRecord,
  encodeEngine,
  type CloudErrorCode,
} from "../../src/cloud/contract";
import { decodePath, encodePath } from "../../src/cloud/polyline";
import {
  FIXTURE_DATASET,
  PLACE_ID,
  ROUTE_ID,
  ROUTE_KEY,
  T0,
  syntheticRoute,
  validPlaceRecord,
  validRouteRecord,
} from "../support/cloud-fixtures";
import { PLACE_MUTATIONS, ROUTE_MUTATIONS } from "../support/cloud-mutations";

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof CloudRecordError ? error.code : `other:${error}`;
  }
  return "ok";
}
async function asyncCodeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof CloudRecordError ? error.code : `other:${error}`;
  }
  return "ok";
}

test("polylines round-trip within 1e-7 degrees, including the extremes and large jumps", () => {
  const points = [
    { latitude: 40.123456789, longitude: -88.987654321 },
    { latitude: 40.123456789, longitude: -88.987654321 },
    { latitude: 90, longitude: 180 },
    { latitude: -90, longitude: -180 },
    { latitude: 0, longitude: 0 },
    { latitude: 40.5, longitude: -89 },
  ];
  const decoded = decodePath(encodePath(points));
  assert.equal(decoded.length, points.length);
  decoded.forEach((point, i) => {
    assert.ok(Math.abs(point.latitude - points[i].latitude) <= 5e-8 + 1e-12);
    assert.ok(Math.abs(point.longitude - points[i].longitude) <= 5e-8 + 1e-12);
  });
  assert.throws(() => decodePath("!!"), RangeError);
  assert.throws(() => decodePath("_"), RangeError);
  assert.throws(
    () => encodePath([{ latitude: NaN, longitude: 0 }]),
    RangeError,
  );
});

test("a saved route builds, validates, and converts to and from its document fields without change", async () => {
  const record = await validRouteRecord();
  const parsed = parseRouteRecord(record);
  assert.deepEqual(parsed, record);
  assert.equal(parsed.dataset.kind, "fixture");
  assert.equal(parsed.engineCodec, ENGINE_CODEC);
  const fields = routeFieldsOf(parsed);
  assert.ok(fields.engine instanceof Uint8Array);
  assert.deepEqual(
    toRouteRecord(fields, { createdAt: T0, updatedAt: T0, revision: 1 }),
    record,
  );
  // The engine route inside describes exactly the geometry the record declares.
  const engine = (await engineMatchesRecord(parsed)) as { segments: unknown[] };
  assert.equal(engine.segments.length, 2);
  // It carries the dataset identity and no dataset content.
  assert.ok(!JSON.stringify(record).includes("paths"));
  assert.deepEqual(Object.keys(record.dataset).sort(), [
    "contentSha256",
    "id",
    "kind",
    "version",
  ]);
});

for (const mutation of ROUTE_MUTATIONS)
  test(`route validator: ${mutation.name} -> ${mutation.ts}`, async () => {
    const record: any = structuredClone(await validRouteRecord());
    mutation.change(record);
    assert.equal(
      codeOf(() => parseRouteRecord(record)),
      mutation.ts,
    );
  });
for (const mutation of PLACE_MUTATIONS)
  test(`place validator: ${mutation.name} -> ${mutation.ts}`, () => {
    const record: any = structuredClone(validPlaceRecord());
    mutation.change(record);
    assert.equal(
      codeOf(() => parsePlaceRecord(record)),
      mutation.ts,
    );
  });

test("a record for another account is refused, never shown", async () => {
  const record = await validRouteRecord("alice");
  assert.equal(
    codeOf(() => requireOwner(record, "alice")),
    "ok",
  );
  assert.equal(
    codeOf(() => requireOwner(record, "bob")),
    "owner-mismatch",
  );
});

test("an engine route that disagrees with the declared geometry is refused", async () => {
  const record = structuredClone(await validRouteRecord());
  const route: any = syntheticRoute();
  route.segments[0].points[1].latitude += 0.001;
  const moved = {
    ...record,
    engine: Buffer.from(await encodeEngine(route)).toString("base64"),
  };
  assert.equal(
    await asyncCodeOf(() => engineMatchesRecord(moved)),
    "geometry-mismatch",
  );
  const fewer: any = syntheticRoute();
  fewer.segments.pop();
  assert.equal(
    await asyncCodeOf(async () =>
      engineMatchesRecord({
        ...record,
        engine: Buffer.from(await encodeEngine(fewer)).toString("base64"),
      }),
    ),
    "geometry-mismatch",
  );
  const noEngine: any = { ...record };
  delete noEngine.engine;
  delete noEngine.engineCodec;
  assert.equal(
    await asyncCodeOf(() => engineMatchesRecord(noEngine)),
    "missing-field",
  );
});

test("an engine payload that expands without bound or is not gzip JSON is refused", async () => {
  const bomb = gzipSync(Buffer.alloc(LIMITS.engineJsonBytes + 1024, 0x20));
  assert.ok(bomb.length < LIMITS.engineBytes);
  assert.equal(
    await asyncCodeOf(() => decodeEngine(bomb)),
    "payload-too-large",
  );
  assert.equal(
    await asyncCodeOf(() => decodeEngine(new Uint8Array([1, 2, 3]))),
    "invalid-field",
  );
  assert.equal(
    await asyncCodeOf(() => decodeEngine(gzipSync("not json"))),
    "invalid-field",
  );
  assert.equal(
    await asyncCodeOf(() =>
      decodeEngine(new Uint8Array(LIMITS.engineBytes + 1)),
    ),
    "payload-too-large",
  );
});

// A random walk is a worst case for the polyline and for gzip: it does not repeat.
function walk(count: number, seed = 1) {
  let state = seed;
  const next = () =>
    ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) *
    2e-4;
  let latitude = 40.5,
    longitude = -88.95;
  return Array.from({ length: count }, () => ({
    latitude: (latitude += next()),
    longitude: (longitude += next()),
  }));
}
function bigRoute(segments: number, perSegment: number, edgesPerSegment = 0) {
  const route: any = syntheticRoute("ExerciseLoop");
  route.segments = Array.from({ length: segments }, (_, i) => ({
    type: "Trail",
    points: walk(perSegment, i + 1),
    isRouted: true,
    routeRoles: ["TrailBranches"],
  }));
  route.edges = route.segments.flatMap((segment: any, i: number) =>
    Array.from({ length: edgesPerSegment }, (_, j) => ({
      id: i * edgesPerSegment + j,
      sourceFeatureId: `54:${j}`,
      status: "Existing",
      routeSegments: [
        { type: "Trail", points: segment.points.slice(0, 3), isRouted: true },
      ],
    })),
  );
  return route;
}
const local = (route: unknown) => ({
  key: ROUTE_KEY,
  title: "Large synthetic route",
  route,
  draft: {
    mode: "loop" as const,
    start: { label: "Start", latitude: 40.5, longitude: -88.95 },
    destination: null,
    miles: 50,
    proposed: false,
  },
  dataset: FIXTURE_DATASET,
});

test("a long route that fits is saved whole, and one that does not fails clearly with nothing built", async () => {
  // 20,000 random points: far beyond the 4,134 points of the longest real route measured (a 100-mile loop).
  const fits = await buildRouteFields({
    id: ROUTE_ID,
    ownerUid: "alice",
    local: local(bigRoute(20, 1000)),
  });
  assert.ok(fits.geometry.length < LIMITS.geometryChars);
  assert.ok(fits.pointCount === 20_000);
  assert.ok(fits.engine!.length < LIMITS.engineBytes);
  const record = toRouteRecord(fits, {
    createdAt: T0,
    updatedAt: T0,
    revision: 1,
  });
  assert.equal(
    codeOf(() => parseRouteRecord(record)),
    "ok",
  );

  // Too many points: refused before anything is produced, so there is no partial save to clean up.
  let built: unknown = "never built";
  await assert.rejects(
    async () => {
      built = await buildRouteFields({
        id: ROUTE_ID,
        ownerUid: "alice",
        local: local(bigRoute(41, 1000)),
      });
    },
    (error) =>
      error instanceof CloudRecordError && error.code === "payload-too-large",
  );
  assert.equal(built, "never built");

  // Too long to travel in one account record.
  const tooLong: any = syntheticRoute("ExerciseLoop");
  tooLong.totalDistanceMeters = LIMITS.lengthMetersMax + 1;
  assert.equal(
    await asyncCodeOf(() =>
      buildRouteFields({
        id: ROUTE_ID,
        ownerUid: "alice",
        local: local(tooLong),
      }),
    ),
    "payload-too-large",
  );

  // An engine payload that will not compress under its budget is refused the same way: 220,000 non-repeating numbers.
  const heavy = bigRoute(5, 200, 1);
  let state = 12345;
  heavy.edges[0].noise = Array.from(
    { length: 220_000 },
    () => (state = (state * 1664525 + 1013904223) % 4294967296),
  );
  assert.equal(
    await asyncCodeOf(() =>
      buildRouteFields({
        id: ROUTE_ID,
        ownerUid: "alice",
        local: local(heavy),
      }),
    ),
    "payload-too-large",
  );
});

test("a route with the engine omitted still builds (a consumer recalculates from its draft)", async () => {
  const record = await validRouteRecord("alice", { engine: false });
  assert.equal(record.engine, undefined);
  assert.equal(
    codeOf(() => parseRouteRecord(record)),
    "ok",
  );
});

test("only fixture and county data may be saved; local review data and malformed provenance are refused", async () => {
  for (const [kind, expected] of [
    ["local", "dataset-not-allowed"],
    ["production", "dataset-not-allowed"],
    ["county", "ok"],
  ] as const)
    assert.equal(
      await asyncCodeOf(() =>
        buildRouteFields({
          id: ROUTE_ID,
          ownerUid: "alice",
          local: {
            ...local(syntheticRoute("ExerciseLoop")),
            draft: {
              mode: "loop",
              start: { label: "Start", latitude: 40.5, longitude: -88.99 },
              destination: null,
              miles: 3,
              proposed: false,
            },
            dataset: { ...FIXTURE_DATASET, kind } as never,
          },
        }),
      ),
      expected,
    );
});

test("a place builds and a bad place does not", () => {
  const fields = buildPlaceFields({
    id: PLACE_ID,
    ownerUid: "alice",
    label: "Trailhead",
    latitude: 40.5,
    longitude: -88.9,
  });
  assert.equal(fields.address, undefined);
  assert.throws(
    () =>
      buildPlaceFields({
        id: PLACE_ID,
        ownerUid: "alice",
        label: "x",
        latitude: 91,
        longitude: 0,
      }),
    (e) =>
      e instanceof CloudRecordError && e.code === "coordinate-out-of-range",
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// the engine payload is validated as a structure, not trusted to be the right shape

async function withEngine(
  change: (engine: any) => void,
  base?: Awaited<ReturnType<typeof validRouteRecord>>,
) {
  const record: any = structuredClone(base ?? (await validRouteRecord()));
  const engine: any = await decodeEngine(
    Uint8Array.from(Buffer.from(record.engine, "base64")),
  );
  change(engine);
  record.engine = Buffer.from(await encodeEngine(engine)).toString("base64");
  return record;
}
const engineCases: Array<[string, (engine: any) => void]> = [
  ["a point with no latitude", (e) => delete e.segments[0].points[0].latitude],
  [
    "a latitude that is text",
    (e) => (e.segments[0].points[0].latitude = "not a coordinate"),
  ],
  ["a latitude that is null", (e) => (e.segments[0].points[0].latitude = null)],
  [
    "a longitude that is an object",
    (e) => (e.segments[0].points[1].longitude = {}),
  ],
  ["a latitude out of range", (e) => (e.segments[0].points[0].latitude = 123)],
  ["a point that is a number", (e) => (e.segments[0].points[0] = 5)],
  ["a point that is null", (e) => (e.segments[0].points[2] = null)],
  ["points that are not a list", (e) => (e.segments[0].points = "x")],
  [
    "a segment with one point",
    (e) => (e.segments[0].points = [e.segments[0].points[0]]),
  ],
  ["a segment that is null", (e) => (e.segments[1] = null)],
  ["a segment type that does not exist", (e) => (e.segments[0].type = "Bike")],
  ["an isRouted that is text", (e) => (e.segments[0].isRouted = "yes")],
  ["no segments", (e) => (e.segments = [])],
  ["segments that are not a list", (e) => (e.segments = {})],
  ["no kind", (e) => delete e.kind],
  ["a kind that does not exist", (e) => (e.kind = "Bike")],
  ["a kind that disagrees with the record", (e) => (e.kind = "ExerciseLoop")],
  ["a length that is text", (e) => (e.totalDistanceMeters = "far")],
  [
    "a length that disagrees with the record",
    (e) => (e.totalDistanceMeters += 10),
  ],
  ["no length", (e) => delete e.totalDistanceMeters],
];
for (const [name, change] of engineCases)
  test(`an engine payload with ${name} is refused with a clear error, never accepted`, async () => {
    const record = await withEngine(change);
    const code = await asyncCodeOf(() => engineMatchesRecord(record));
    assert.notEqual(code, "ok");
    assert.ok(!code.startsWith("other:"), code);
  });
test("an engine payload that is not an object is refused", async () => {
  for (const value of [null, [], "text", 7]) {
    const record: any = structuredClone(await validRouteRecord());
    record.engine = Buffer.from(await encodeEngine(value)).toString("base64");
    const code = await asyncCodeOf(() => engineMatchesRecord(record));
    assert.ok(
      code !== "ok" && !code.startsWith("other:"),
      `${JSON.stringify(value)}: ${code}`,
    );
  }
});
test("an untouched engine payload still matches, so the checks above are not just refusing everything", async () => {
  assert.equal(
    await asyncCodeOf(async () =>
      engineMatchesRecord(await withEngine(() => {})),
    ),
    "ok",
  );
});

test("a route's kind and plan must pair up, in both directions, in the builder, the reader and the engine summary", async () => {
  const point = await validRouteRecord();
  const loop = await validRouteRecord("alice", {
    kind: "ExerciseLoop",
    id: "r_loopkind0123456789abcdef01234",
  });
  assert.equal(
    codeOf(() => parseRouteRecord(point)),
    "ok",
  );
  assert.equal(
    codeOf(() => parseRouteRecord(loop)),
    "ok",
  );
  // Flipping only the kind, either way.
  assert.equal(
    codeOf(() => parseRouteRecord({ ...point, kind: "ExerciseLoop" })),
    "invalid-field",
  );
  assert.equal(
    codeOf(() => parseRouteRecord({ ...loop, kind: "Navigation" })),
    "invalid-field",
  );
  // The builder refuses a route whose engine kind and plan disagree.
  const navigation = { ...local(syntheticRoute("Navigation")) };
  const loopDraft = {
    mode: "loop" as const,
    start: { label: "Start", latitude: 40.5, longitude: -88.99 },
    destination: null,
    miles: 3,
    proposed: false,
  };
  assert.equal(
    await asyncCodeOf(() =>
      buildRouteFields({
        id: ROUTE_ID,
        ownerUid: "alice",
        local: { ...navigation, draft: loopDraft },
      }),
    ),
    "invalid-field",
  );
  assert.equal(
    await asyncCodeOf(() =>
      buildRouteFields({
        id: ROUTE_ID,
        ownerUid: "alice",
        local: {
          ...local(syntheticRoute("ExerciseLoop")),
          draft: {
            mode: "point" as const,
            start: { label: "Start", latitude: 40.5, longitude: -88.99 },
            destination: { label: "End", latitude: 40.52, longitude: -88.97 },
            miles: null,
            proposed: false,
          },
        },
      }),
    ),
    "invalid-field",
  );
  // A consistent record whose ENGINE says the other kind is refused when the engine is checked against it.
  const altered = await withEngine(
    (engine) => (engine.kind = "Navigation"),
    loop,
  );
  assert.equal(
    await asyncCodeOf(() => engineMatchesRecord(altered)),
    "geometry-mismatch",
  );
  const alteredPoint = await withEngine(
    (engine) => (engine.kind = "ExerciseLoop"),
    point,
  );
  assert.equal(
    await asyncCodeOf(() => engineMatchesRecord(alteredPoint)),
    "geometry-mismatch",
  );
});

test("timestamps must be real RFC 3339 instants and an update cannot precede its creation", async () => {
  const record: any = structuredClone(await validRouteRecord());
  for (const bad of [
    "2026",
    "1",
    "",
    "2026-10-01",
    "2026-10-01T12:00:00",
    "2026-13-01T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-10-01T24:00:00Z",
    "2026-10-01T12:60:00Z",
    "2026-10-01T12:00:00+24:00",
    "yesterday",
    5,
    null,
  ])
    assert.equal(
      codeOf(() => parseRouteRecord({ ...record, createdAt: bad })),
      "invalid-field",
      String(bad),
    );
  for (const good of [
    "2028-02-29T23:59:59Z",
    "2026-10-01T12:00:00.123456789Z",
    "2026-10-01T12:00:00-05:00",
  ])
    assert.equal(
      codeOf(() =>
        parseRouteRecord({
          ...record,
          createdAt: good,
          updatedAt: "2030-01-01T00:00:00Z",
        }),
      ),
      "ok",
      good,
    );
  assert.equal(
    codeOf(() =>
      parseRouteRecord({
        ...record,
        createdAt: "2026-10-02T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
      }),
    ),
    "invalid-field",
  );
  const place: any = structuredClone(validPlaceRecord());
  assert.equal(
    codeOf(() => parsePlaceRecord({ ...place, updatedAt: "2026" })),
    "invalid-field",
  );
  assert.equal(
    codeOf(() =>
      parsePlaceRecord({
        ...place,
        createdAt: "2026-10-02T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
      }),
    ),
    "invalid-field",
  );
});

test("the engine payload bytes are the same on every platform for the same route (gzip header OS byte fixed)", async () => {
  const bytes = await encodeEngine(syntheticRoute());
  assert.equal(bytes[9], 255);
  assert.deepEqual(
    await decodeEngine(bytes),
    JSON.parse(JSON.stringify(syntheticRoute())),
  );
});
