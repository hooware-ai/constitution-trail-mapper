import test from "node:test";
import assert from "node:assert/strict";
import {
  LocalRouteStore,
  ActiveRideStore,
  LIBRARY_KEY,
  QUARANTINE_KEY,
  ACTIVE_RIDE_KEY,
  RECENT_MAX_AGE_MS,
  stableRouteKey,
  type RouteRecord,
  type StoragePort,
} from "../../src/platform/storage";
import { privateRouteShare, routeGeoJson } from "../../src/platform/sharing";
class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  fail = false;
  /** Total stored characters allowed across all keys (browser-like quota); unlimited by default. */
  limit = Infinity;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    const others = [...this.values]
      .filter(([existing]) => existing !== key)
      .reduce((sum, [name, text]) => sum + name.length + text.length, 0);
    if (this.fail || others + key.length + value.length > this.limit)
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
    mode: "point",
    start: { label: "Private home", latitude: 40, longitude: -89 },
    destination: { label: "Private work", latitude: 40.02, longitude: -89 },
    miles: 5,
    proposed: false,
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

const seed = (
  storage: MemoryStorage,
  library: Partial<Record<"saved" | "recent" | "places", unknown[]>>,
) =>
  storage.values.set(
    LIBRARY_KEY,
    JSON.stringify({
      version: 1,
      saved: [],
      recent: [],
      places: [],
      ...library,
    }),
  );
test("a record with a null or malformed draft never reaches the app and does not hide valid records", () => {
  for (const draft of [
    null,
    "x",
    [],
    {},
    { mode: "walk" },
    { mode: "point" },
  ]) {
    const storage = new MemoryStorage();
    seed(storage, {
      recent: [{ ...record("bad"), draft }, record("good")],
    });
    const result = new LocalRouteStore(storage, () => NOW).read();
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.state.recent.map((item) => item.key),
      ["good"],
    );
    assert.equal(result.quarantined, 1);
  }
});
test("invalid saved, recent and place records are quarantined while valid ones survive", () => {
  const storage = new MemoryStorage();
  seed(storage, {
    saved: [record("saved-ok"), { ...record("saved-bad"), route: null }],
    recent: [{ ...record("recent-bad"), draft: null }, record("recent-ok")],
    places: [
      { key: "p", label: "Park", latitude: 40, longitude: -89, createdAt: NOW },
      {
        key: "q",
        label: "Nowhere",
        latitude: 400,
        longitude: -89,
        createdAt: NOW,
      },
    ],
  });
  const store = new LocalRouteStore(storage, () => NOW);
  const result = store.read();
  assert.equal(result.quarantined, 3);
  assert.deepEqual(
    result.state.saved.map((item) => item.key),
    ["saved-ok"],
  );
  assert.deepEqual(
    result.state.recent.map((item) => item.key),
    ["recent-ok"],
  );
  assert.deepEqual(
    result.state.places.map((item) => item.key),
    ["p"],
  );
  // Only the rejected records are kept, and they stay until the rider deletes them.
  assert.equal(store.hasQuarantine(), true);
  const kept = JSON.parse(storage.values.get(QUARANTINE_KEY)!);
  assert.deepEqual(
    kept.map((entry: any) => [entry.kind, entry.record.key]),
    [
      ["saved", "saved-bad"],
      ["recent", "recent-bad"],
      ["places", "q"],
    ],
  );
  // The library was rewritten, so a later read is clean and later writes work.
  assert.equal(store.read().quarantined, undefined);
  assert.equal(store.save(record("new")).ok, true);
  assert.equal(store.hasQuarantine(), true);
  assert.equal(store.discardUnreadable().ok, true);
  assert.equal(store.hasQuarantine(), false);
  assert.equal(store.read().state.saved.length, 2);
});
test("a failed quarantine write preserves the original library and still shows valid records", () => {
  const storage = new MemoryStorage();
  seed(storage, {
    recent: [{ ...record("bad"), draft: null }, record("good")],
  });
  const original = storage.values.get(LIBRARY_KEY);
  storage.fail = true;
  const result = new LocalRouteStore(storage, () => NOW).read();
  assert.equal(result.ok, false);
  assert.equal(result.error, "quota");
  assert.equal(result.pendingUnreadable, 1);
  assert.deepEqual(
    result.state.recent.map((item) => item.key),
    ["good"],
  );
  assert.equal(storage.values.get(LIBRARY_KEY), original);
});
test("a non-array collection is still corrupt and preserved", () => {
  const storage = new MemoryStorage();
  storage.values.set(
    LIBRARY_KEY,
    JSON.stringify({ version: 1, saved: {}, recent: [], places: [] }),
  );
  assert.equal(new LocalRouteStore(storage, () => NOW).read().error, "corrupt");
});
test("an active ride with a malformed record is reported corrupt instead of restored", () => {
  const storage = new MemoryStorage();
  storage.values.set(
    ACTIVE_RIDE_KEY,
    JSON.stringify({
      version: 1,
      record: { ...record(), draft: null },
      routeProgressMeters: 1,
      creditedDistanceMeters: 1,
      updatedAt: NOW,
    }),
  );
  const result = new ActiveRideStore(storage).read();
  assert.equal(result.ok, false);
  assert.equal(result.error, "corrupt");
  assert.equal(result.state, null);
});

test("a place with a non-string address is unreadable instead of crashing the place list", () => {
  const storage = new MemoryStorage();
  const place = (key: string, address?: unknown) => ({
    key,
    label: "Park",
    latitude: 40,
    longitude: -89,
    createdAt: NOW,
    address,
  });
  seed(storage, {
    places: [place("ok", "1 Main St"), place("bad", { bad: "record" })],
    recent: [
      {
        ...record("bad-endpoint"),
        draft: {
          ...(record().draft as any),
          destination: { label: "x", latitude: 40, longitude: -89, address: 5 },
        },
      },
    ],
  });
  const result = new LocalRouteStore(storage, () => NOW).read();
  assert.deepEqual(
    result.state.places.map((item) => item.key),
    ["ok"],
  );
  assert.equal(result.state.recent.length, 0);
  assert.equal(result.quarantined, 2);
});
test("setting aside unreadable records never needs a second copy of the library, so a nearly full store still recovers", () => {
  const storage = new MemoryStorage();
  const many = Array.from({ length: 12 }, (_, index) =>
    record("saved-" + index),
  );
  seed(storage, {
    saved: many,
    recent: [{ ...record("bad"), draft: null }],
  });
  const libraryBytes =
    LIBRARY_KEY.length + storage.values.get(LIBRARY_KEY)!.length;
  // Room for the library plus only a small amount extra: a full-library snapshot would not fit.
  storage.limit = libraryBytes + 600;
  const store = new LocalRouteStore(storage, () => NOW);
  const result = store.read();
  assert.equal(result.ok, true);
  assert.equal(result.quarantined, 1);
  assert.equal(result.state.saved.length, 12);
  // Deleting a route (freeing space) works even though unreadable data is present.
  assert.equal(store.deleteSaved("saved-0").ok, true);
  assert.equal(store.hasQuarantine(), true);
});
test("unreadable data is retained across repeated corruption until the rider deletes it", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  for (const key of ["a", "b", "c", "d"]) {
    seed(storage, { recent: [{ ...record(key), draft: null }] });
    assert.equal(store.read().quarantined, 1);
  }
  assert.equal(JSON.parse(storage.values.get(QUARANTINE_KEY)!).length, 4);
  // Re-reading the same rejected record does not duplicate it.
  seed(storage, { recent: [{ ...record("d"), draft: null }] });
  store.read();
  assert.equal(JSON.parse(storage.values.get(QUARANTINE_KEY)!).length, 4);
  assert.equal(store.discardUnreadable().ok, true);
  assert.equal(store.hasQuarantine(), false);
});
test("discarding after a partial failure reports success only once nothing unreadable remains", () => {
  const storage = new MemoryStorage();
  seed(storage, {
    recent: [{ ...record("bad"), draft: null }, record("good")],
  });
  const store = new LocalRouteStore(storage, () => NOW);
  // Quarantine fits, but rewriting the library without the bad record does not.
  const realSet = storage.setItem.bind(storage);
  storage.setItem = (key: string, value: string) => {
    if (key === LIBRARY_KEY)
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    realSet(key, value);
  };
  const first = store.read();
  assert.equal(first.ok, false);
  assert.equal(first.quarantined, 1);
  assert.equal(store.hasQuarantine(), true);
  // Storage is still failing for the library: discarding must not claim success.
  const failed = store.discardUnreadable();
  assert.equal(failed.ok, false);
  assert.equal(failed.pendingUnreadable, 1);
  // Storage recovers: now the discard truly leaves nothing unreadable behind.
  storage.setItem = realSet;
  const done = store.discardUnreadable();
  assert.equal(done.ok, true);
  assert.equal(store.hasQuarantine(), false);
  const after = store.read();
  assert.equal(after.quarantined, undefined);
  assert.equal(store.hasQuarantine(), false);
  assert.deepEqual(
    after.state.recent.map((item) => item.key),
    ["good"],
  );
});
test("a change that cannot set unreadable data aside is rolled back instead of silently dropping it", () => {
  const storage = new MemoryStorage();
  seed(storage, {
    saved: [record("keep")],
    recent: [{ ...record("bad"), draft: null }],
  });
  const original = storage.values.get(LIBRARY_KEY)!;
  const store = new LocalRouteStore(storage, () => NOW);
  const realSet = storage.setItem.bind(storage);
  storage.setItem = (key: string, value: string) => {
    if (key === QUARANTINE_KEY)
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    realSet(key, value);
  };
  const result = store.deleteSaved("keep");
  assert.equal(result.ok, false);
  assert.equal(result.pendingUnreadable, 1);
  assert.equal(storage.values.get(LIBRARY_KEY), original);
});
