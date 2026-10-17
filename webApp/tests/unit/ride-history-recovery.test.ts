import test from "node:test";
import assert from "node:assert/strict";
import {
  CARRIED_RIDE_KEY,
  CarriedRideStore,
  type CarriedRide,
  type StoragePort,
} from "../../src/platform/storage";

const ride = (recordKey: string, distanceMeters: number): CarriedRide => ({
  recordKey,
  carried: {
    distanceMeters,
    traversalEdges: [{ key: recordKey, distanceMeters }],
  },
});

function fixture() {
  const values = new Map<string, string>();
  let fail = false;
  const storage: StoragePort = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw new DOMException("full", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return {
    store: new CarriedRideStore(storage),
    values,
    fail: () => {
      fail = true;
    },
  };
}

test("legacy carry restores by matching active key and never applies to another ride", () => {
  const f = fixture();
  const saved = ride("saved", 300);
  f.values.set(CARRIED_RIDE_KEY, JSON.stringify({ version: 1, ...saved }));
  assert.deepEqual(f.store.read("saved"), saved);
  assert.equal(f.store.read("unrelated"), null);
});

test("repeated failed active replacements retain the actually saved carry without accumulating earlier replacements", () => {
  const f = fixture();
  const saved = ride("saved", 300);
  const second = ride("second", 600);
  const third = ride("third", 900);
  assert.equal(f.store.write(saved), true);
  assert.equal(f.store.write(second, "saved"), true);
  assert.deepEqual(f.store.read("saved"), saved);
  assert.deepEqual(f.store.read("second"), second);
  assert.equal(f.store.write(third, "saved"), true);
  assert.deepEqual(f.store.read("saved"), saved);
  assert.deepEqual(f.store.read(), third);
  assert.equal(f.store.read("second"), null);
  const raw = JSON.parse(f.values.get(CARRIED_RIDE_KEY)!);
  assert.deepEqual(raw.previous, saved);
  assert.equal(raw.previous.previous, undefined);

  // Once the third active ride was saved, its carry is the only recovery fallback needed on the next rejoin.
  const fourth = ride("fourth", 1200);
  assert.equal(f.store.write(fourth, "third"), true);
  assert.equal(f.store.read("saved"), null);
  assert.deepEqual(f.store.read("third"), third);
  assert.deepEqual(f.store.read("fourth"), fourth);
  assert.deepEqual(JSON.parse(f.values.get(CARRIED_RIDE_KEY)!).previous, third);
});

test("a failed carry write preserves both current and fallback histories, and malformed fallback is never restored", () => {
  const f = fixture();
  assert.equal(f.store.write(ride("saved", 300)), true);
  assert.equal(f.store.write(ride("second", 600), "saved"), true);
  const before = f.values.get(CARRIED_RIDE_KEY);
  f.fail();
  assert.equal(f.store.write(ride("third", 900), "saved"), false);
  assert.equal(f.values.get(CARRIED_RIDE_KEY), before);
  const raw = JSON.parse(before!);
  raw.previous.carried.distanceMeters = -1;
  f.values.set(CARRIED_RIDE_KEY, JSON.stringify(raw));
  assert.equal(f.store.read("saved"), null);
  assert.deepEqual(f.store.read("second"), ride("second", 600));
});
