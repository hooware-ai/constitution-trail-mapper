import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPlaces, LOCAL_CENTER, places } from "../../src/search";
test("issue 29: Hershey Culver’s ranks above west branch from selected east start", () => {
  const rows = searchPlaces("Culver's", { latitude: 40.49, longitude: -88.95 });
  assert.match(rows[0].label, /Hershey/);
  assert.match(rows[1].label, /West/);
  assert.match(rows[0].address!, /Hershey/);
});
test("changing start reverses proximity order, selected objects are immutable", () => {
  const selected = places.find((p) => p.label.includes("Hershey Road"))!;
  const original = JSON.stringify(selected);
  assert.match(
    searchPlaces("Culver", { latitude: 40.48, longitude: -89.025 })[0].label,
    /West/,
  );
  assert.equal(JSON.stringify(selected), original);
});
test("unresolved start uses local fallback; unmatched text does not resolve", () => {
  assert.deepEqual(
    searchPlaces("Culver", null),
    searchPlaces("Culver", LOCAL_CENTER),
  );
  assert.equal(searchPlaces("not a resolved location", null).length, 0);
});
