import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildPlaceFields,
  buildRouteFields,
  decodeGeometry,
  engineMatchesRecord,
  parsePlaceRecord,
  parseRouteRecord,
  routeFieldsOf,
  toRouteRecord,
  type CloudDatasetIdentity,
  type RouteRecord,
} from "../../src/cloud/contract";
import { stableRouteKey } from "../../src/platform/storage";

// Round trip through the REAL shared Kotlin routing core (the same engine native clients share): a route the engine
// planned is saved to the cloud contract, read back, handed to the engine again, and still describes the same route.
// The engine's serialized route is the only Kotlin serialization in a record, so this is the web <-> Kotlin proof.
const root = resolve(process.cwd(), "..");
const corePath = join(
  root,
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
const south = { latitude: 40.49, longitude: -88.95 };
const west = { latitude: 40.49, longitude: -88.99 };

async function engine() {
  const core: any = await import(pathToFileURL(corePath).href);
  const call = (request: unknown) =>
    JSON.parse(core.dispatch(JSON.stringify(request)));
  const trails = await readFile(
    join(process.cwd(), "src", "data", "review-network.json"),
    "utf8",
  );
  const text = JSON.stringify(JSON.parse(trails));
  const dataset: CloudDatasetIdentity = {
    kind: "fixture",
    id: "synthetic-review-network",
    version: "1",
    contentSha256: createHash("sha256").update(text).digest("hex"),
  };
  const init = call({
    op: "initialize",
    trails: text,
    dataset,
    trustSerializedRoutes: true,
    now: NOW,
  });
  assert.equal(init.ok, true);
  return { call, dataset };
}
const localOf = (route: any, dataset: CloudDatasetIdentity, draft: any) => ({
  key: stableRouteKey({ kind: route.kind, segments: route.segments }),
  title: "Synthetic ride",
  route,
  draft,
  dataset,
});
const pointDraft = (start: any, destination: any) => ({
  mode: "point" as const,
  start: { label: "Start", ...start },
  destination: { label: "Finish", ...destination },
  miles: null,
  proposed: false,
});

test(
  "a planned route survives the cloud contract and the engine reads it back as the same route",
  { skip },
  async () => {
    const { call, dataset } = await engine();
    const planned = call({
      op: "plan",
      start: east,
      destination: south,
      proposed: false,
      now: NOW,
    });
    assert.ok(planned.route, planned.error);
    const fields = await buildRouteFields({
      id: "r_roundtrip0123456789abcdef0123",
      ownerUid: "fixture-user-a",
      local: localOf(planned.route, dataset, pointDraft(east, south)),
    });
    const record = parseRouteRecord(
      JSON.parse(
        JSON.stringify(
          toRouteRecord(fields, {
            createdAt: "2026-10-01T15:00:00Z",
            updatedAt: "2026-10-01T15:00:00Z",
            revision: 1,
          }),
        ),
      ),
    );
    // The engine route inside the record is the engine's own, and matches the geometry the record declares.
    const restored: any = await engineMatchesRecord(record);
    // Identity: the same edges and the same features, in the same order.
    assert.deepEqual(
      restored.edges.map((edge: any) => [
        edge.id,
        edge.sourceFeatureId,
        edge.status,
      ]),
      planned.route.edges.map((edge: any) => [
        edge.id,
        edge.sourceFeatureId,
        edge.status,
      ]),
    );
    // Handed back to the engine, it inspects as the same, navigable route on the same dataset.
    const inspected = call({ op: "inspect", route: restored, now: NOW });
    assert.equal(inspected.canNavigate, true);
    assert.equal(inspected.network.status, "current");
    assert.equal(inspected.distance, planned.distance);
    assert.equal(inspected.segments.length, planned.segments.length);
    // Geometry: every point within the polyline's 1 cm quantisation of what the engine planned.
    const declared = decodeGeometry(
      record.geometry,
      record.pointCount,
      record.bounds,
    );
    planned.segments.forEach((segment: any, i: number) =>
      segment.points.forEach((point: any, j: number) => {
        assert.ok(
          Math.abs(declared[i].points[j].latitude - point.latitude) <= 1e-7,
        );
        assert.ok(
          Math.abs(declared[i].points[j].longitude - point.longitude) <= 1e-7,
        );
      }),
    );
    // The dataset identity travels (not the dataset): a reader can tell what it was planned on.
    assert.deepEqual(record.dataset, dataset);
  },
);

test(
  "replacing a route keeps its identity, owner and creation time and changes only what was recalculated",
  { skip },
  async () => {
    const { call, dataset } = await engine();
    const first = call({
      op: "plan",
      start: east,
      destination: south,
      proposed: false,
      now: NOW,
    });
    const second = call({
      op: "plan",
      start: east,
      destination: west,
      proposed: false,
      now: NOW,
    });
    assert.ok(first.route && second.route);
    const id = "r_replaced0123456789abcdef01234";
    const original = toRouteRecord(
      await buildRouteFields({
        id,
        ownerUid: "fixture-user-a",
        local: localOf(first.route, dataset, pointDraft(east, south)),
      }),
      {
        createdAt: "2026-10-01T15:00:00Z",
        updatedAt: "2026-10-01T15:00:00Z",
        revision: 1,
      },
    );
    // The replacement is a new write to the SAME record: same id, owner and created time; revision + 1.
    const replacement: RouteRecord = toRouteRecord(
      await buildRouteFields({
        id,
        ownerUid: "fixture-user-a",
        local: localOf(second.route, dataset, pointDraft(east, west)),
      }),
      {
        createdAt: original.createdAt,
        updatedAt: "2026-10-01T16:00:00Z",
        revision: original.revision + 1,
      },
    );
    parseRouteRecord(replacement);
    assert.equal(replacement.id, original.id);
    assert.equal(replacement.ownerUid, original.ownerUid);
    assert.equal(replacement.createdAt, original.createdAt);
    assert.equal(replacement.revision, 2);
    assert.notEqual(replacement.routeKey, original.routeKey);
    assert.notEqual(replacement.geometry, original.geometry);
    // And the new record describes the NEW route end to end.
    const restored: any = await engineMatchesRecord(replacement);
    assert.equal(
      call({ op: "inspect", route: restored, now: NOW }).distance,
      second.distance,
    );
    assert.deepEqual(
      routeFieldsOf(replacement).draft.destination?.latitude,
      west.latitude,
    );
  },
);

test("a saved place round-trips by identity and coordinates", () => {
  const fields = buildPlaceFields({
    id: "p_roundtrip0123456789abcdef0123",
    ownerUid: "fixture-user-a",
    label: "Synthetic trailhead",
    latitude: east.latitude,
    longitude: east.longitude,
  });
  const record = parsePlaceRecord(
    JSON.parse(
      JSON.stringify({
        ...fields,
        createdAt: "2026-10-01T15:00:00Z",
        updatedAt: "2026-10-01T15:00:00Z",
        revision: 1,
      }),
    ),
  );
  assert.equal(record.id, fields.id);
  assert.equal(record.latitude, east.latitude);
  assert.equal(record.longitude, east.longitude);
});

test(
  "a corrupted record never reaches the engine: a damaged engine payload or geometry is refused first",
  { skip },
  async () => {
    const { call, dataset } = await engine();
    const planned = call({
      op: "plan",
      start: east,
      destination: south,
      proposed: false,
      now: NOW,
    });
    const good = toRouteRecord(
      await buildRouteFields({
        id: "r_corrupt0123456789abcdef012345",
        ownerUid: "fixture-user-a",
        local: localOf(planned.route, dataset, pointDraft(east, south)),
      }),
      {
        createdAt: "2026-10-01T15:00:00Z",
        updatedAt: "2026-10-01T15:00:00Z",
        revision: 1,
      },
    );
    const damaged = {
      ...good,
      engine: good.engine!.slice(0, 40) + "AAAA" + good.engine!.slice(44),
    };
    await assert.rejects(() => engineMatchesRecord(damaged));
    assert.throws(() =>
      parseRouteRecord({ ...good, geometry: good.geometry.slice(0, 20) }),
    );
  },
);
