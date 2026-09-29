import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserSessionStore,
  SESSION_KEY,
  type BrowserSession,
} from "../../src/platform/session";
import {
  LocalRouteStore,
  RECENT_MAX_AGE_MS,
  type StoragePort,
} from "../../src/platform/storage";
class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail)
      throw Object.assign(new Error(), { name: "QuotaExceededError" });
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const NOW = 2_000_000_000_000;
function session(): BrowserSession {
  return {
    version: 1,
    screen: "planner",
    draft: {
      mode: "loop",
      start: { label: "Trailhead", latitude: 40, longitude: -89 },
      destination: null,
      miles: 5,
      proposed: false,
    },
    selected: null,
    savedTab: "recent",
    origin: "planner",
    updatedAt: NOW,
  };
}
test("resolved planner draft restores without persisting autocomplete or transient fields", () => {
  const storage = new MemoryStorage(),
    store = new BrowserSessionStore(storage, () => NOW),
    value = session();
  (value.draft as any).query = "a private unfinished search";
  assert.equal(store.write(value).ok, true);
  const restored = new BrowserSessionStore(storage, () => NOW).read().state!;
  assert.equal(restored.screen, "planner");
  assert.equal(restored.draft.mode, "loop");
  assert.equal(restored.draft.start?.label, "Trailhead");
  assert.equal(restored.draft.miles, 5);
  assert.doesNotMatch(
    storage.values.get(SESSION_KEY)!,
    /private unfinished|query/,
  );
});
test("preview recovery preserves raw route separately without recording a new recent", () => {
  const storage = new MemoryStorage(),
    store = new BrowserSessionStore(storage, () => NOW),
    value = session();
  value.screen = "preview";
  value.selected = {
    key: "route",
    title: "Loop",
    createdAt: NOW,
    usedAt: NOW,
    route: { segments: [] },
    draft: value.draft,
  };
  store.write(value);
  assert.deepEqual(store.read().state?.selected?.route, { segments: [] });
  assert.equal(
    new LocalRouteStore(storage, () => NOW).read().state.recent.length,
    0,
  );
  value.screen = "saved";
  store.write(value);
  assert.equal(store.read().state?.selected, null);
  assert.equal(store.read().state?.draft.start, null);
});
test("session expires at 30 days and corrupt data remains untouched", () => {
  const storage = new MemoryStorage();
  let now = NOW;
  const store = new BrowserSessionStore(storage, () => now);
  store.write(session());
  now += RECENT_MAX_AGE_MS;
  assert.equal(store.read().state, null);
  assert.equal(storage.values.has(SESSION_KEY), false);
  storage.values.set(SESSION_KEY, "broken");
  assert.equal(store.read().error, "corrupt");
  assert.equal(store.write(session()).ok, false);
  assert.equal(storage.values.get(SESSION_KEY), "broken");
});
test("session quota failure is reported and empty custom miles can restore for correction", () => {
  const storage = new MemoryStorage(),
    store = new BrowserSessionStore(storage, () => NOW),
    value = session();
  value.draft.miles = NaN;
  store.write(value);
  assert.equal(Number.isNaN(store.read().state?.draft.miles), true);
  storage.fail = true;
  assert.equal(store.write(value).error, "quota");
});
