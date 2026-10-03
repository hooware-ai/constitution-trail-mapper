import test from "node:test";
import assert from "node:assert/strict";
import {
  ActiveRideStore,
  LocalRouteStore,
  stableRouteKey,
  type RouteRecord,
  type StoragePort,
} from "../../src/platform/storage";
import { BrowserSessionStore } from "../../src/platform/session";

// A recalculated route is a TEMPORARY record: it has an identity minted once, it is in no library list until the rider
// saves it, saving it never overwrites the route it came from, and its status survives a reload without any library write.
class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  writes: string[] = [];
  failFor: string | null = null;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failFor && key.includes(this.failFor))
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    this.writes.push(key);
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const NOW = 2_000_000_000_000;
const draft = {
  mode: "point" as const,
  start: { label: "A", latitude: 40, longitude: -89 },
  destination: { label: "B", latitude: 40.02, longitude: -89 },
  miles: 5,
  proposed: false,
};
const segments = [
  {
    type: "Trail",
    points: [
      { latitude: 40, longitude: -89 },
      { latitude: 40.02, longitude: -89 },
    ],
    isRouted: true,
  },
];
const geometry = stableRouteKey({ kind: "Navigation", segments });
const original = (): RouteRecord => ({
  key: geometry,
  title: "A to B",
  createdAt: NOW,
  usedAt: NOW,
  route: { kind: "Navigation", segments },
  draft,
});
/** What a recalculation makes: the same geometry, a minted identity, temporary, remembering its original. */
const candidate = (from: RouteRecord, suffix = "1"): RouteRecord => ({
  ...original(),
  key: `${geometry}~r${suffix}`,
  geometryKey: geometry,
  title: "A to B (recalculated)",
  temporary: true,
  recalculatedFrom: { key: from.key, title: from.title },
});

test("a temporary route is never written to Recent, and the library never stores the flag", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  const saved = original();
  assert.equal(store.save(saved).ok, true);
  const before = storage.values.get([...storage.values.keys()][0]!);
  const made = candidate(saved);
  // Showing, restoring or starting a temporary route never reaches the library.
  const result = store.recordSuccess(made);
  assert.equal(result.ok, true);
  assert.equal(storage.values.get([...storage.values.keys()][0]!), before);
  assert.equal(store.read().state.recent.length, 0);
  // Saving is the only way in, and the stored record is an ordinary one.
  assert.equal(store.save(made).ok, true);
  const library = store.read().state;
  assert.equal(library.saved.length, 2);
  assert.ok(library.saved.every((item) => item.temporary === undefined));
});

test("saving a recalculated route with the SAME geometry as the original or as another saved route adds a record and overwrites nothing", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  const saved = original();
  store.save(saved);
  const other: RouteRecord = {
    ...original(),
    key: "someone-elses",
    title: "Other",
  };
  store.save(other);
  const first = candidate(saved, "a");
  const second = candidate(saved, "b");
  assert.equal(first.geometryKey, saved.key);
  assert.equal(store.save(first).ok, true);
  assert.equal(store.save(second).ok, true);
  // Saving the same candidate again is the same record (an identity minted once), never a third copy.
  assert.equal(store.save(first).ok, true);
  const keys = store
    .read()
    .state.saved.map((item) => item.key)
    .sort();
  assert.deepEqual(keys, [saved.key, other.key, first.key, second.key].sort());
  const kept = store.read().state.saved.find((item) => item.key === saved.key)!;
  assert.equal(kept.title, "A to B");
  assert.equal(kept.geometryKey, undefined);
  assert.deepEqual(kept.route, saved.route);
});

test("a quota failure on Save reports it, leaves the library and the original intact, and the route stays temporary", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  const saved = original();
  store.save(saved);
  const snapshot = JSON.stringify(store.read().state);
  storage.failFor = "library";
  const made = candidate(saved);
  const result = store.save(made);
  assert.equal(result.ok, false);
  assert.equal(result.error, "quota");
  storage.failFor = null;
  assert.equal(JSON.stringify(store.read().state), snapshot);
  assert.equal(made.temporary, true);
});

test("the temporary status, identity, geometry key, original and planned direction survive a reload through the session, and nothing is written to the library", () => {
  const storage = new MemoryStorage();
  const library = new LocalRouteStore(storage, () => NOW);
  library.save(original());
  const libraryKeys = [...storage.values.keys()];
  const librarySnapshot = libraryKeys.map((key) => storage.values.get(key));
  const session = new BrowserSessionStore(storage, () => NOW);
  const planned = candidate(original());
  // A loop ridden in reverse: its own record points at the planned one and proves the direction by GEOMETRY.
  const reversed: RouteRecord = {
    ...original(),
    key: "reversed-geometry",
    title: planned.title,
    plannedKey: planned.key,
    plannedGeometryKey: planned.geometryKey,
    temporary: true,
    recalculatedFrom: planned.recalculatedFrom,
  };
  for (const selected of [planned, reversed]) {
    const written = session.write({
      version: 1,
      screen: "preview",
      draft,
      selected,
      savedTab: "saved",
      origin: "saved",
      updatedAt: NOW,
    });
    assert.equal(written.ok, true);
    const restored = session.read().state!.selected!;
    assert.equal(restored.temporary, true);
    assert.equal(restored.key, selected.key);
    assert.equal(restored.geometryKey, selected.geometryKey);
    assert.equal(restored.plannedKey, selected.plannedKey);
    assert.equal(restored.plannedGeometryKey, selected.plannedGeometryKey);
    assert.deepEqual(restored.recalculatedFrom, selected.recalculatedFrom);
  }
  // Only the session key was written; the library is exactly as it was.
  assert.ok(
    storage.writes
      .slice(libraryKeys.length)
      .every((key) => key.includes("session")),
  );
  assert.deepEqual(
    libraryKeys.map((key) => storage.values.get(key)),
    librarySnapshot,
  );
});

test("records saved before recalculated routes had identities of their own are unchanged and still valid", () => {
  const storage = new MemoryStorage();
  const store = new LocalRouteStore(storage, () => NOW);
  store.save(original());
  const read = store.read().state.saved[0]!;
  assert.equal(read.key, geometry);
  assert.equal(read.geometryKey, undefined);
  assert.equal(read.temporary, undefined);
  assert.equal(read.recalculatedFrom, undefined);
  // And a malformed new field is refused rather than stored.
  const bad = { ...original(), temporary: false } as unknown as RouteRecord;
  assert.equal(store.save(bad).ok, false);
  const worse = {
    ...original(),
    recalculatedFrom: { key: "" },
  } as unknown as RouteRecord;
  assert.equal(store.save(worse).ok, false);
});

test("an active ride on a temporary route keeps its status for the restored ride", () => {
  const storage = new MemoryStorage();
  const rides = new ActiveRideStore(storage);
  const made = candidate(original());
  const written = rides.write({
    version: 1,
    record: made,
    routeProgressMeters: 10,
    creditedDistanceMeters: 10,
    updatedAt: NOW,
  });
  assert.equal(written.ok, true);
  const restored = rides.read().state!.record;
  assert.equal(restored.temporary, true);
  assert.equal(restored.key, made.key);
  assert.equal(restored.geometryKey, geometry);
});
