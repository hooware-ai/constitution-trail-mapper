import test from "node:test";
import assert from "node:assert/strict";
import {
  LocalRouteStore,
  ActiveRideStore,
  LIBRARY_KEY,
  RECENT_MAX_AGE_MS,
  stableRouteKey,
  type RouteRecord,
  type StoragePort,
} from "../../src/platform/storage";
import { privateRouteShare, routeGeoJson } from "../../src/platform/sharing";
class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail)
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const NOW = 2_000_000_000_000;
const record = (key = "one", usedAt = NOW): RouteRecord => ({
  key,
  title: "Private home to work",
  createdAt: NOW,
  usedAt,
  route: {
    coordinates: [
      [-89, 40],
      [-89, 40.02],
    ],
  },
  draft: {
    destination: { label: "Private work", latitude: 40.02, longitude: -89 },
  },
});
test("successful routes deduplicate, saving moves an item, opening and deleting saved never resurrect it", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  assert.equal(store.read().state.recent.length, 0);
  store.recordSuccess(record());
  store.recordSuccess(record());
  assert.equal(store.read().state.recent.length, 1);
  assert.equal(store.save(record()).ok, true);
  assert.equal(store.read().state.recent.length, 0);
  store.open("one");
  store.recordSuccess(record());
  assert.equal(store.read().state.recent.length, 0);
  store.deleteSaved("one");
  assert.equal(store.read().state.recent.length, 0);
  assert.equal(store.read().state.saved.length, 0);
});
test("recent routes cap at 20, expire at 30 days, and reopening updates their use", () => {
  let now = NOW;
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => now);
  for (let index = 0; index < 23; index++) {
    now++;
    store.recordSuccess(record(String(index), now));
  }
  assert.equal(store.read().state.recent.length, 20);
  assert.equal(store.read().state.recent[0].key, "22");
  now++;
  store.open("3");
  assert.equal(store.read().state.recent[0].key, "3");
  now += RECENT_MAX_AGE_MS;
  assert.equal(store.read().state.recent.length, 0);
  assert.equal(JSON.parse(storage.values.get(LIBRARY_KEY)!).recent.length, 0);
});
test("clear recent routes preserves saved routes and places across browser reload", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  store.save(record("saved"));
  store.recordSuccess(record("recent"));
  store.savePlace({
    key: "place",
    label: "Park",
    latitude: 40,
    longitude: -89,
    createdAt: NOW,
  });
  store.clearRecents();
  const reopened = new LocalRouteStore(storage, () => NOW).read();
  assert.equal(reopened.state.saved.length, 1);
  assert.equal(reopened.state.places.length, 1);
  assert.equal(reopened.state.recent.length, 0);
});
test("quota failure never reports a route saved or removes its recent copy", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  store.recordSuccess(record());
  storage.fail = true;
  const result = store.save(record());
  assert.equal(result.ok, false);
  assert.equal(result.error, "quota");
  assert.equal(result.state.saved.length, 0);
  assert.equal(result.state.recent.length, 1);
});
test("corrupt and future-version data is reported and preserved until explicit reset", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  storage.values.set(LIBRARY_KEY, "{broken");
  assert.equal(store.read().error, "corrupt");
  assert.equal(store.save(record()).ok, false);
  assert.equal(storage.values.get(LIBRARY_KEY), "{broken");
  storage.values.set(LIBRARY_KEY, '{"version":2}');
  assert.equal(store.read().error, "unsupported-version");
  store.reset();
  assert.equal(store.read().ok, true);
});
test("stable route key ignores object-property order and no title participates unless explicitly supplied", () => {
  assert.equal(
    stableRouteKey({ a: 1, b: [2, 3] }),
    stableRouteKey({ b: [2, 3], a: 1 }),
  );
  assert.notEqual(stableRouteKey([2, 3]), stableRouteKey([3, 2]));
});
test("active ride persists only route/progress and round-trips independently of recents", () => {
  const storage = new MemoryStorage();
  const store = new ActiveRideStore(storage);
  store.write({
    version: 1,
    record: record(),
    routeProgressMeters: 23,
    creditedDistanceMeters: 15,
    updatedAt: NOW,
  });
  assert.equal(
    new ActiveRideStore(storage).read().state?.routeProgressMeters,
    23,
  );
  store.clear();
  assert.equal(store.read().state, null);
});
test("share never exposes private query, route path, hash, endpoint labels, or coordinates", () => {
  const share = privateRouteShare(
    "https://example.test/private-home/route?lat=40&lon=-89#destination",
    1000,
  );
  assert.equal(share.url, "https://example.test/");
  assert.doesNotMatch(
    JSON.stringify(share),
    /private-home|lat=|destination.*40|-89/,
  );
});
test("default GeoJSON removes exact endpoint areas, private labels and draft while retaining attribution", () => {
  const result = routeGeoJson(
    record(),
    [
      [-89, 40],
      [-89, 40.02],
    ],
    { action: "download" },
  );
  assert.equal(result.privacy, "endpoints-removed");
  assert.match(result.attribution, /OpenStreetMap/);
  const coordinates = result.features.flatMap(
    (feature) => feature.geometry.coordinates,
  );
  assert.ok(
    coordinates.every((point) => point[1] > 40.003 && point[1] < 40.017),
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /Private home|Private work|destination|draft/,
  );
});
test("full route export needs explicit approval; a short private route fails closed", () => {
  assert.throws(
    () =>
      routeGeoJson(
        record(),
        [
          [-89, 40],
          [-89, 40.02],
        ],
        { action: "download", includeExactEndpoints: true },
      ),
    /Confirm/,
  );
  const exact = routeGeoJson(
    record(),
    [
      [-89, 40],
      [-89, 40.02],
    ],
    {
      action: "download",
      includeExactEndpoints: true,
      fullRouteApproved: true,
    },
  );
  assert.deepEqual(exact.features[0].geometry.coordinates[0], [-89, 40]);
  assert.throws(
    () =>
      routeGeoJson(
        record(),
        [
          [-89, 40],
          [-89, 40.001],
        ],
        { action: "download" },
      ),
    /too short/,
  );
});

test("recalculation atomically replaces saved geometry without creating a recent or losing its saved home", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  store.save(record("old"));
  const replaced = store.replace("old", record("new"));
  assert.equal(replaced.ok, true);
  assert.deepEqual(
    replaced.state.saved.map((item) => item.key),
    ["new"],
  );
  assert.equal(replaced.state.recent.length, 0);
  storage.fail = true;
  const failed = store.replace("new", record("third"));
  assert.equal(failed.ok, false);
  assert.deepEqual(
    failed.state.saved.map((item) => item.key),
    ["new"],
  );
});
test("exact GeoJSON preserves disconnected source paths without inventing connecting chords", () => {
  const result = routeGeoJson(
    record(),
    [
      [-89, 40],
      [-89, 40.02],
      [-88, 41],
      [-88, 41.02],
    ],
    {
      action: "download",
      includeExactEndpoints: true,
      fullRouteApproved: true,
      segmentBreaks: [2],
    },
  );
  assert.equal(result.features.length, 2);
  assert.deepEqual(
    result.features[0].geometry.coordinates.at(-1),
    [-89, 40.02],
  );
  assert.deepEqual(result.features[1].geometry.coordinates[0], [-88, 41]);
});

const three: Array<[number, number]> = [
  [-89, 40.0],
  [-89, 40.01],
  [-89, 40.02],
  [-89, 40.03],
  [-89, 40.04],
  [-89, 40.05],
];
const context = (
  extra: Partial<import("../../src/platform/sharing").ExportContext> = {},
) => ({
  kind: "Navigation",
  dataset: { label: "Test dataset", mode: "fixture" },
  exportedAt: "2026-09-30T00:00:00.000Z",
  warnings: [],
  closures: [],
  gaps: [],
  ...extra,
});
const info = (...roles: string[][]) =>
  roles.map((r) => ({ type: "Trail", roles: r }));
test("an ordinary verified route exports every segment as verified existing trail, with context", () => {
  const result = routeGeoJson(record(), three, {
    action: "download",
    includeExactEndpoints: true,
    fullRouteApproved: true,
    segmentBreaks: [2, 4],
    segments: info(["TrailBranches"], ["TrailBranches"], ["TrailBranches"]),
    context: context(),
  });
  assert.equal(result.features.length, 3);
  for (const feature of result.features) {
    assert.equal(feature.geometry.type, "LineString");
    assert.equal(feature.properties.status, "existing");
    assert.equal(feature.properties.verified, true);
  }
  assert.equal(result.routeContext?.proposedTrailsIncluded, false);
  assert.match(String(result.routeContext?.note), /ignore properties/);
  assert.equal((result.routeContext?.dataset as any).label, "Test dataset");
});
test("a proposed segment is flagged as not built and unverified, and the collection says so", () => {
  const result = routeGeoJson(record(), three, {
    action: "download",
    includeExactEndpoints: true,
    fullRouteApproved: true,
    segmentBreaks: [2, 4],
    segments: info(["TrailBranches"], ["ProposedTrails"], ["TrailBranches"]),
    context: context({ warnings: ["This route includes proposed trails."] }),
  });
  const proposed = result.features[1].properties;
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.verified, false);
  assert.deepEqual(proposed.roles, ["ProposedTrails"]);
  assert.equal(result.features[0].properties.status, "existing");
  assert.equal(result.routeContext?.proposedTrailsIncluded, true);
  assert.deepEqual(result.routeContext?.warnings, [
    "This route includes proposed trails.",
  ]);
});
test("an unverified connection is exported as its two ends only, never as a connecting line", () => {
  const result = routeGeoJson(record(), three, {
    action: "download",
    includeExactEndpoints: true,
    fullRouteApproved: true,
    segmentBreaks: [2, 4],
    segments: info(["TrailBranches"], ["TrailBranches"], ["TrailBranches"]),
    context: context({
      gaps: [
        {
          id: "gap-0",
          distanceMeters: 42.04,
          from: [-89, 40.015],
          to: [-89, 40.0151],
        },
      ],
    }),
  });
  const gap = result.features.find(
    (f) => f.properties.status === "unverified-connection",
  )!;
  assert.equal(gap.geometry.type, "MultiPoint");
  assert.equal(gap.properties.verified, false);
  assert.equal(gap.properties.distanceMeters, 42);
  // No line feature spans the gap: every line is one segment.
  for (const feature of result.features.filter(
    (f) => f.geometry.type === "LineString",
  ))
    assert.ok(feature.geometry.coordinates.length === 2);
  assert.equal(result.routeContext?.unverifiedConnections, 1);
});
test("private mode keeps trimming, and omits a connection whose end lies in a hidden endpoint area", () => {
  const result = routeGeoJson(record(), three, {
    action: "download",
    segmentBreaks: [2, 4],
    segments: info(["TrailBranches"], ["TrailBranches"], ["TrailBranches"]),
    context: context({
      gaps: [
        {
          id: "near-start",
          distanceMeters: 5,
          from: [-89, 40.0005],
          to: [-89, 40.0006],
        },
        {
          id: "middle",
          distanceMeters: 5,
          from: [-89, 40.025],
          to: [-89, 40.0251],
        },
      ],
    }),
  });
  const gaps = result.features.filter(
    (f) => f.properties.status === "unverified-connection",
  );
  assert.equal(gaps.length, 1);
  assert.equal(result.routeContext?.unverifiedConnections, 2);
  assert.equal(
    result.routeContext?.unverifiedConnectionsOmittedNearHiddenEndpoints,
    1,
  );
  const coordinates = result.features
    .filter((f) => f.geometry.type === "LineString")
    .flatMap((f) => f.geometry.coordinates);
  assert.ok(coordinates.every((c) => c[1] > 40.003 && c[1] < 40.047));
  // Line features keep the segment they came from.
  assert.ok(result.features.some((f) => f.properties.segmentType === "trail"));
});
test("changed closure status and warnings travel with the file; private labels never do", () => {
  const open = routeGeoJson(record(), three, {
    action: "download",
    includeExactEndpoints: true,
    fullRouteApproved: true,
    segmentBreaks: [2, 4],
    segments: info(["TrailBranches"], ["TrailBranches"], ["TrailBranches"]),
    context: context(),
  });
  const closed = routeGeoJson(record(), three, {
    action: "download",
    includeExactEndpoints: true,
    fullRouteApproved: true,
    segmentBreaks: [2, 4],
    segments: info(["TrailBranches"], ["TrailBranches"], ["TrailBranches"]),
    context: context({
      closures: [
        {
          title: "Trail closed",
          message: "Closed for flooding",
          sourceUrl: "https://example.test/closure",
        },
      ],
      warnings: ["Trail closed: Closed for flooding"],
    }),
  });
  assert.deepEqual(open.routeContext?.closures, []);
  assert.equal((closed.routeContext?.closures as any[]).length, 1);
  assert.equal(
    (closed.routeContext?.closures as any[])[0].title,
    "Trail closed",
  );
  assert.doesNotMatch(
    JSON.stringify(closed),
    /Private home|Private work|draft/,
  );
});
test("context that cannot be matched to the geometry blocks the export with a recoverable explanation", () => {
  assert.throws(
    () =>
      routeGeoJson(record(), three, {
        action: "download",
        includeExactEndpoints: true,
        fullRouteApproved: true,
        segmentBreaks: [2, 4],
        segments: info(["TrailBranches"]),
        context: context(),
      }),
    /do not match the route geometry.*Reopen the route/,
  );
  assert.throws(
    () =>
      routeGeoJson(record(), three, {
        action: "download",
        includeExactEndpoints: true,
        fullRouteApproved: true,
        segmentBreaks: [2, 4],
        context: context(),
      }),
    /Route details are unavailable/,
  );
});
