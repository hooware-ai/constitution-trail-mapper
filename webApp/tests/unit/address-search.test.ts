import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AddressIndex,
  buildAddressIndex,
  serializeAddressIndex,
  type AddressIndexData,
  type RawAddressRow,
} from "../../src/addressIndex";
import {
  ADDRESS_POINT_NOTE,
  FIXTURE_ADDRESS_INDEX_PATH,
  addressChoices,
  addressIndexSource,
  loadAddressIndex,
  looksLikeAddress,
} from "../../src/addressSearch";

// Synthetic rows only: nothing here is county data.
let oid = 0;
const row = (
  address: string,
  city: string,
  longitude: number,
  latitude: number,
  unit: string | null = null,
): RawAddressRow => ({
  oid: ++oid,
  address,
  building: null,
  unit,
  city,
  zip: "61761",
  longitude,
  latitude,
});
const data = () =>
  buildAddressIndex([
    row("421 N Main St", "Normal", -88.95, 40.5, "A"),
    row("421 N Main St", "Normal", -88.95, 40.504, "B"),
    row("421 N Main St", "Bloomington", -88.99, 40.48),
    row("100 E Mulberry St", "Normal", -88.98, 40.51),
    row("300 E Mulberry St", "Normal", -88.97, 40.51),
  ]).data;
const index = () =>
  new AddressIndex(
    JSON.parse(serializeAddressIndex(data())) as AddressIndexData,
  );

test("only a house number plus street text starts address search", () => {
  for (const yes of [
    "421 n main",
    "12A Oak",
    "12-5 Elm",
    "7 1/2 Pine st",
    " 9 x",
  ])
    assert.equal(looksLikeAddress(yes), true, yes);
  for (const no of [
    "",
    "main",
    "421",
    "421 ",
    "Tipton Park",
    "Review trailhead · East",
    "n 421 main",
  ])
    assert.equal(looksLikeAddress(no), false, no);
});

test("a build with no index offers no address source, fixture or county; only an opted-in review build or the development test seam does", () => {
  const built = { file: "data/address-index.abc.json", sha256: "x" };
  assert.equal(addressIndexSource(null, false), null);
  assert.deepEqual(addressIndexSource(null, true), {
    url: FIXTURE_ADDRESS_INDEX_PATH,
    sha256: null,
  });
  assert.deepEqual(addressIndexSource(built, false), {
    url: built.file,
    sha256: "x",
  });
  // A built index wins over the seam: the seam never replaces a real, pinned file.
  assert.equal(addressIndexSource(built, true)?.url, built.file);
});

test("the same address at two recorded points gives two distinct choices with city, units, point and the not-an-entrance label", () => {
  const { choices, notice } = addressChoices(index().search("421 n main st"), {
    latitude: 40.5,
    longitude: -88.95,
    label: "start",
  });
  assert.equal(choices.length, 3);
  assert.match(notice!, /3 county address points match/);
  assert.equal(new Set(choices.map((c) => c.key)).size, 3);
  for (const choice of choices) {
    assert.match(choice.detail, new RegExp(ADDRESS_POINT_NOTE));
    assert.match(choice.detail, /Point \d of 3/);
    assert.match(choice.detail, /m from your start/);
  }
  const normal = choices.filter((c) => /Normal/.test(c.detail));
  assert.equal(normal.length, 2);
  assert.notEqual(normal[0].endpoint.latitude, normal[1].endpoint.latitude);
  assert.match(normal.map((c) => c.detail).join("|"), /Units: A/);
  assert.match(normal.map((c) => c.detail).join("|"), /Units: B/);
  assert.ok(choices.some((c) => /Bloomington/.test(c.detail)));
  // The endpoint is exactly the recorded point: no snapping, and it says what it is.
  for (const c of choices)
    assert.match(c.endpoint.address!, /not a verified trail entrance/);
});

test("a single match carries no ambiguity notice; missing numbers offer only the nearest numbers and say they are not the typed address", () => {
  const one = addressChoices(index().search("100 e mulberry"), null);
  assert.equal(one.choices.length, 1);
  assert.equal(one.notice, null);
  const gap = addressChoices(index().search("200 e mulberry"), null);
  assert.equal(gap.choices.length, 2);
  assert.match(gap.notice!, /not in the county address data/);
  for (const c of gap.choices)
    assert.match(c.detail, /not the number you typed/);
  assert.equal(
    addressChoices(index().search("9 nowhere blvd"), null).choices.length,
    0,
  );
});

test("the index loads once, only from its fixed file, and a wrong hash or missing file is refused and can be retried", async () => {
  const text = serializeAddressIndex(data());
  const sha = createHash("sha256").update(text).digest("hex");
  const calls: string[] = [];
  const good = (async (url: URL | string) => {
    calls.push(String(url));
    return new Response(text);
  }) as typeof fetch;
  const source = { url: "data/address-index.test-a.json", sha256: sha };
  const [a, b] = await Promise.all([
    loadAddressIndex(source, good),
    loadAddressIndex(source, good),
  ]);
  assert.equal(a, b);
  assert.deepEqual(calls, ["http://localhost/data/address-index.test-a.json"]);
  await assert.rejects(
    loadAddressIndex(
      { url: "data/address-index.test-b.json", sha256: "0".repeat(64) },
      good,
    ),
    /did not match/,
  );
  const missing = (async () =>
    new Response("no", { status: 404 })) as typeof fetch;
  await assert.rejects(
    loadAddressIndex(
      { url: "data/address-index.test-c.json", sha256: null },
      missing,
    ),
    /not available/,
  );
  // not cached after a failure
  const again = await loadAddressIndex(
    { url: "data/address-index.test-c.json", sha256: null },
    good,
  );
  assert.ok(again.size > 0);
});
