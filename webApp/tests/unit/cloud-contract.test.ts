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
  const route: any = syntheticRoute();
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
  const tooLong: any = syntheticRoute();
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
            ...local(syntheticRoute()),
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
