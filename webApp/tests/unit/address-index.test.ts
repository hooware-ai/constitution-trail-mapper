import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AddressIndex,
  MAX_REVERSE_METERS,
  buildAddressIndex,
  parseNumber,
  serializeAddressIndex,
  tokens,
  type AddressIndexData,
  type RawAddressRow,
} from "../../src/addressIndex";

// Synthetic rows only: nothing here is county data.
let oid = 0;
const row = (
  address: string,
  city: string,
  longitude: number,
  latitude: number,
  extra: Partial<RawAddressRow> = {},
): RawAddressRow => ({
  oid: ++oid,
  address,
  building: null,
  unit: null,
  city,
  zip: "61701",
  longitude,
  latitude,
  ...extra,
});
const rows: RawAddressRow[] = [
  row("421 NORTH MAIN STREET", "Bloomington", -88.993, 40.48),
  row("421 N Main St", "Normal", -88.999, 40.52),
  row("423 N Main St", "Normal", -88.9991, 40.5201),
  row("425 N Main St", "Normal", -88.9992, 40.5202),
  row("100 E Mulberry St", "Normal", -88.98, 40.51),
  row("108 E Mulberry St", "Normal", -88.9798, 40.5101),
  row("204 E Mulberry St", "Normal", -88.979, 40.5102),
  row("300 W COLLEGE AVE", "Normal", -88.987, 40.5106),
  row("300 W College Ave", "Normal", -88.987, 40.5106), // exact duplicate
  row("1020 S Morris Ave", "Bloomington", -89.0037, 40.4682, { unit: "A" }),
  row("1020 S Morris Ave", "Bloomington", -89.0037, 40.4682, { unit: "B" }),
  row("1020 S Morris Ave", "Bloomington", -89.0037, 40.4682, {
    building: "2",
    unit: "C",
  }),
  row("12A Oak Ln", "Normal", -88.97, 40.5),
  row("12 Oak Ln", "Normal", -88.9701, 40.5001),
  row("50 Elm Ct", "Hudson", -88.9, 40.6),
  row("52 Elm Ct", "Hudson", -88.9, 40.6001, { longitude: null }), // no point
  row("Gas Station", "Normal", -88.9, 40.5), // no number
  row("77 Far Rd", "Elsewhere", -90.0, 41.0),
];
const built = () => buildAddressIndex(rows, (r) => r.address !== "77 Far Rd");
const index = () =>
  new AddressIndex(
    JSON.parse(serializeAddressIndex(built().data)) as AddressIndexData,
  );

test("normalization maps directionals, street types and punctuation to one form", () => {
  assert.deepEqual(tokens("421 North Main Street"), ["421", "N", "MAIN", "ST"]);
  assert.deepEqual(tokens("1807 W. Market St."), ["1807", "W", "MARKET", "ST"]);
  assert.deepEqual(tokens("206 W. College Ave."), [
    "206",
    "W",
    "COLLEGE",
    "AVE",
  ]);
  assert.deepEqual(parseNumber("12A"), { num: 12, suffix: "A" });
  assert.deepEqual(parseNumber("12-5"), { num: 12, suffix: "-5" });
  assert.equal(parseNumber("MAIN"), null);
});

test("the build is deterministic, order independent, and reports every exclusion", () => {
  const a = serializeAddressIndex(built().data);
  const b = serializeAddressIndex(
    buildAddressIndex([...rows].reverse(), (r) => r.address !== "77 Far Rd")
      .data,
  );
  assert.equal(a, b);
  const { report } = built();
  assert.equal(report.rows, rows.length);
  assert.equal(report.skippedNotMcLean, 1);
  assert.equal(report.skippedNoPoint, 1);
  assert.equal(report.skippedNoNumber, 1);
  assert.equal(report.exactDuplicatesDropped, 1);
  assert.equal(report.indexed, rows.length - 4);
});

test("an exact address is one place; the same number in two cities is ambiguous, never merged", () => {
  const found = index().search("421 n main st");
  assert.equal(found.kind, "matches");
  if (found.kind !== "matches") return;
  assert.equal(found.ambiguous, true);
  assert.deepEqual(found.places.map((p) => p.city).sort(), [
    "Bloomington",
    "Normal",
  ]);
  assert.ok(found.places.every((p) => p.source === "county-address-point"));
  const one = index().search("423 N Main Street");
  assert.equal(one.kind === "matches" && one.ambiguous, false);
});

test("typed text may leave out the directional, spell out the street type and use any case or punctuation", () => {
  const found = index().search("100 mulberry street");
  assert.equal(found.kind, "matches");
  assert.equal(
    found.kind === "matches" && found.places[0].label,
    "100 E Mulberry St, Normal",
  );
  assert.equal(index().search("  300  w. COLLEGE ave. ").kind, "matches");
});

test("units at one number are one place and are listed, not multiplied", () => {
  const found = index().search("1020 S Morris");
  assert.equal(found.kind, "matches");
  if (found.kind !== "matches") return;
  assert.equal(found.places.length, 1);
  assert.deepEqual(found.places[0].units.sort(), ["A", "B", "BLDG 2 C"]);
});

test("a suffix is part of the number: 12A is not 12", () => {
  const a = index().search("12A Oak Ln");
  const plain = index().search("12 Oak Ln");
  assert.equal(a.kind === "matches" && a.places[0].number, "12A");
  assert.equal(plain.kind === "matches" && plain.places[0].number, "12");
  assert.notEqual(
    a.kind === "matches" && a.places[0].latitude,
    plain.kind === "matches" && plain.places[0].latitude,
  );
});

test("a number that is not on a street reports the numbers either side and invents no point", () => {
  const found = index().search("150 e mulberry");
  assert.equal(found.kind, "nearest-numbers");
  if (found.kind !== "nearest-numbers") return;
  assert.equal(found.lower?.label, "108 E Mulberry St, Normal");
  assert.equal(found.higher?.label, "204 E Mulberry St, Normal");
  const past = index().search("999 e mulberry");
  assert.equal(past.kind === "nearest-numbers" && past.higher, null);
});

test("a street name alone lists streets; no street, or an empty or number-only query, is no match", () => {
  assert.equal(index().search("mulb").kind, "streets");
  assert.equal(index().search("9 nowhere blvd").kind, "none");
  assert.equal(index().search("").kind, "none");
  assert.equal(index().search("421").kind, "none");
});

test("rows outside the county, without a number or without a point are not indexed", () => {
  assert.equal(index().search("77 far rd").kind, "none");
  assert.equal(index().search("52 elm ct").kind, "nearest-numbers");
  assert.equal(index().search("gas station").kind, "none");
});

test("reverse label is the nearest address point within the bound, else nothing", () => {
  const i = index();
  const near = i.nearest({ latitude: 40.51005, longitude: -88.98 });
  assert.equal(near?.label, "100 E Mulberry St, Normal");
  assert.ok(near!.distanceMeters < 10);
  assert.equal(i.nearest({ latitude: 40.51005, longitude: -88.98 }, 1), null);
  assert.equal(i.nearest({ latitude: 40.55, longitude: -88.8 }), null);
  // The bound is the caller's: a larger one finds a farther point, a smaller one finds none.
  assert.ok(i.nearest({ latitude: 40.5, longitude: -88.966 }, 500));
  assert.equal(i.nearest({ latitude: 40.5, longitude: -88.966 }, 75), null);
});

test("reverse label ties break deterministically and a point that is only a point is never called an entrance", () => {
  const found = index().nearest({ latitude: 40.4682, longitude: -89.0037 });
  assert.equal(found?.source, "county-address-point");
  assert.equal("entrance" in (found as object), false);
});

test("the module cannot upload typed text or positions: no network, storage, timer, DOM or global access", () => {
  const source = readFileSync(
    join(import.meta.dirname, "../../src/addressIndex.ts"),
    "utf8",
  )
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  for (const forbidden of [
    /\bfetch\b/,
    /XMLHttpRequest/,
    /WebSocket/,
    /sendBeacon/,
    /EventSource/,
    /localStorage|sessionStorage|indexedDB/,
    /\bnavigator\b/,
    /\bdocument\b/,
    /\bwindow\b/,
    /setTimeout|setInterval/,
    /^\s*import\s/m,
    /\brequire\b/,
  ]) {
    assert.doesNotMatch(source, forbidden, String(forbidden));
  }
});

test("the prototype is not wired into the app", () => {
  const src = join(import.meta.dirname, "../../src");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  const users = walk(src).filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) &&
      !f.endsWith("addressIndex.ts") &&
      /addressIndex/.test(readFileSync(f, "utf8")),
  );
  assert.deepEqual(users, []);
});

// ---- review corrections (TM-LOCAL-PREP-7c675b5-20261004-01) ---------------------------------------------------------

const indexOf = (extra: RawAddressRow[]) =>
  new AddressIndex(
    JSON.parse(
      serializeAddressIndex(buildAddressIndex(extra).data),
    ) as AddressIndexData,
  );

test("the same address recorded at two different points is two places and ambiguous; units group only at one recorded point", () => {
  const found = indexOf([
    row("421 NORTH MAIN STREET", "Normal", -89, 40.5, { unit: "A" }),
    row("421 NORTH MAIN STREET", "Normal", -89, 40.504, { unit: "B" }),
  ]).search("421 n main st");
  assert.equal(found.kind, "matches");
  if (found.kind !== "matches") return;
  assert.equal(found.ambiguous, true);
  assert.equal(found.places.length, 2);
  assert.deepEqual(
    found.places.map((p) => [p.latitude, p.units]),
    [
      [40.5, ["A"]],
      [40.504, ["B"]],
    ],
  );
  const same = indexOf([
    row("421 NORTH MAIN STREET", "Normal", -89, 40.5, { unit: "A" }),
    row("421 NORTH MAIN STREET", "Normal", -89, 40.5, { unit: "B" }),
  ]).search("421 n main st");
  assert.equal(same.kind === "matches" && same.ambiguous, false);
  assert.deepEqual(same.kind === "matches" && same.places[0].units, ["A", "B"]);
});

test("a partly typed street type matches its canonical alias but never widens into unrelated names", () => {
  const i = indexOf([
    row("421 N Main Street", "Normal", -89, 40.5),
    row("5 Main Stone Rd", "Normal", -89, 40.51),
    row("7 Oak Avenue", "Normal", -89, 40.52),
    row("9 Elm Boulevard", "Normal", -89, 40.53),
  ]);
  for (const typed of [
    "421 n main s",
    "421 n main st",
    "421 n main stre",
    "421 n main stree",
    "421 n main street",
  ]) {
    const found = i.search(typed);
    assert.equal(found.kind, "matches", typed);
    assert.equal(
      found.kind === "matches" && found.places[0].label,
      "421 N Main St, Normal",
      typed,
    );
  }
  // "stre" is STREET in progress: it must not pull in "Main Stone Rd" for a number that only exists there.
  const stone = i.search("5 main stre");
  assert.notEqual(stone.kind, "matches");
  assert.equal(i.search("7 oak aven").kind, "matches");
  assert.equal(i.search("9 elm boul").kind, "matches");
  assert.equal(i.search("9 elm boulev").kind, "matches");
});

test("the reverse bound is honoured on both axes and capped", () => {
  const i = indexOf([
    row("1 Center St", "Normal", -89, 40.5),
    row("2 Birch St", "Normal", -88.995, 40.6),
    row("3 North St", "Normal", -89, 40.7),
  ]);
  // 0.004 degrees of latitude is about 445 m: found at 500 m, absent at the default 75 m and at 400 m.
  assert.equal(
    i.nearest({ latitude: 40.496, longitude: -89 }, 500)?.label,
    "1 Center St, Normal",
  );
  assert.equal(
    i.nearest({ latitude: 40.504, longitude: -89 }, 500)?.label,
    "1 Center St, Normal",
  );
  assert.equal(i.nearest({ latitude: 40.496, longitude: -89 }), null);
  assert.equal(i.nearest({ latitude: 40.496, longitude: -89 }, 400), null);
  // 0.005 degrees of longitude is about 425 m at this latitude.
  assert.equal(
    i.nearest({ latitude: 40.6, longitude: -88.99 }, 500)?.label,
    "2 Birch St, Normal",
  );
  assert.equal(i.nearest({ latitude: 40.6, longitude: -88.99 }, 300), null);
  // The cap: nothing 11 km away is found however large a bound is asked for.
  assert.equal(
    i.nearest({ latitude: 40.6, longitude: -89.2 }, 1_000_000),
    null,
  );
  assert.equal(MAX_REVERSE_METERS, 2000);
  assert.equal(
    i.nearest({ latitude: 40.5, longitude: -89 }, -5)?.distanceMeters,
    0,
  );
});
