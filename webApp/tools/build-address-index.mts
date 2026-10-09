// Builds the address-index PROTOTYPE from the fetched raw county rows, pins the inputs and transform in a manifest, and
// measures the result. Offline: it reads the ignored raw file written by fetch-mcgis-addresses.mjs and writes ONLY to the
// ignored data/generated directory (the index and its measurements), plus an optional pin manifest path you name.
//
//   npx tsx tools/build-address-index.mts [--raw <raw.json>] [--out <index.json>] [--manifest <pin.json>]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  ADDRESS_INDEX_SCHEMA,
  AddressIndex,
  TRANSFORM_VERSION,
  buildAddressIndex,
  serializeAddressIndex,
  type AddressIndexData,
  type RawAddressRow,
} from "../src/addressIndex.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rawFile = resolve(
  arg("--raw") ??
    join(repoRoot, "data", "generated", "mcgis-addresses.raw.json"),
);
const outFile = resolve(
  arg("--out") ?? join(repoRoot, "data", "generated", "web-address-index.json"),
);
const manifestFile = arg("--manifest") ? resolve(arg("--manifest")!) : null;
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const rawText = readFileSync(rawFile, "utf8");
const raw = JSON.parse(rawText) as {
  schema: string;
  columns: string[];
  rows: (string | number | null)[][];
};
if (raw.schema !== "trail-mapper.address-points.raw/1")
  throw new Error("Not a raw county address file.");
const fetchManifest = JSON.parse(
  readFileSync(rawFile.replace(/\.json$/, ".fetch.json"), "utf8"),
);
if (fetchManifest.rawFile.sha256 !== sha256(rawText))
  throw new Error("The raw file does not match its fetch manifest.");

const col = Object.fromEntries(raw.columns.map((name, i) => [name, i]));
const rows: RawAddressRow[] = raw.rows.map((r) => ({
  oid: r[col.OBJECTID_1] as number,
  address: r[col.ADDRESS] as string | null,
  building: r[col.Building] as string | null,
  unit: r[col.Unit] as string | null,
  city: r[col.Post_Comm] as string | null,
  zip: r[col.Post_Code] as string | null,
  longitude: r[col.x] as number | null,
  latitude: r[col.y] as number | null,
}));
const countyOf = new Map<number, string | null>(
  raw.rows.map((r) => [
    r[col.OBJECTID_1] as number,
    r[col.County] as string | null,
  ]),
);
// The service holds a few points for neighbouring counties; the prototype indexes McLean County only (its trail network).
const isMcLean = (row: RawAddressRow) =>
  (countyOf.get(row.oid) ?? "").toUpperCase() === "MCLEAN COUNTY";
const countyCounts: Record<string, number> = {};
for (const c of countyOf.values())
  countyCounts[c ?? "(none)"] = (countyCounts[c ?? "(none)"] ?? 0) + 1;

let t = performance.now();
const { data, report } = buildAddressIndex(rows, isMcLean);
const buildMs = performance.now() - t;
const text = serializeAddressIndex(data);
if (report.indexed === 0)
  throw new Error(
    "The county filter indexed nothing: stop and review the County values.",
  );
const second = serializeAddressIndex(
  buildAddressIndex([...rows].reverse(), isMcLean).data,
);
if (second !== text)
  throw new Error(
    "The build is not deterministic: reversed input gave a different index.",
  );
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, text);

const bytes = Buffer.byteLength(text);
const gzip = gzipSync(text, { level: 9 }).length;
const brotli = brotliCompressSync(text, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).length;

// ---- timings --------------------------------------------------------------------------------------------------------------
const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
t = performance.now();
const loaded = new AddressIndex(JSON.parse(text) as AddressIndexData);
const loadMs = performance.now() - t; // parse + decode (a cold index in memory)
const queries = [
  "421 n main st",
  "2210 stone mountain blvd",
  "1 w",
  "206 w college",
  "801 north main street",
  "1020 s morris",
  "901 hershey",
  "1807 w market",
  "9999 nowhere rd",
  "100 main",
];
const searchMs: number[] = [];
for (let round = 0; round < 20; round++)
  for (const q of queries) {
    const s = performance.now();
    loaded.search(q);
    searchMs.push(performance.now() - s);
  }
t = performance.now();
loaded.nearest({ latitude: 40.49, longitude: -88.97 }); // first call builds the grid
const firstNearestMs = performance.now() - t;
const points = [
  [40.5092876, -88.9268806],
  [40.4865112, -88.9426574],
  [40.4844551, -89.0211334],
  [40.510642, -88.98648],
  [40.5208939, -88.9952965],
  [40.4682086, -89.0036962],
  [40.55, -88.8],
  [40.3, -89.3],
];
const nearestMs: number[] = [];
for (let round = 0; round < 50; round++)
  for (const [latitude, longitude] of points) {
    const s = performance.now();
    loaded.nearest({ latitude, longitude });
    nearestMs.push(performance.now() - s);
  }
const p95 = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];
const timings = {
  buildMs: Math.round(buildMs),
  loadMs: Math.round(loadMs),
  searchMedianMs: Number(median(searchMs).toFixed(3)),
  searchP95Ms: Number(p95(searchMs).toFixed(3)),
  firstNearestIncludingGridMs: Number(firstNearestMs.toFixed(1)),
  nearestMedianMs: Number(median(nearestMs).toFixed(3)),
  nearestP95Ms: Number(p95(nearestMs).toFixed(3)),
  node: process.version,
  note: "Node on this development machine; not a phone. Indicative only.",
};

// How often one address (street, number, suffix, postal community) has more than one recorded point: those searches are
// ambiguous by design (a different point is a different place), so the rate matters to any later UI.
const pointAmbiguity = (() => {
  const d = loaded.data;
  const groups = new Map<string, Set<string>>();
  const spread = new Map<string, { lat: number[]; lon: number[] }>();
  let la = 0,
    lo = 0;
  for (let e = 0; e < d.num.length; e++) {
    la += d.lat[e];
    lo += d.lon[e];
    let street = 0;
    {
      let lowEnd = 0,
        highEnd = d.start.length - 2;
      while (lowEnd < highEnd) {
        const mid = (lowEnd + highEnd + 1) >> 1;
        if (d.start[mid] <= e) lowEnd = mid;
        else highEnd = mid - 1;
      }
      street = lowEnd;
    }
    const key = `${street}|${d.num[e]}|${d.suffix[e]}|${d.city[e]}`;
    (groups.get(key) ?? groups.set(key, new Set()).get(key)!).add(
      `${la}|${lo}`,
    );
    const s = spread.get(key) ?? { lat: [], lon: [] };
    s.lat.push(la);
    s.lon.push(lo);
    spread.set(key, s);
  }
  let multi = 0,
    over50 = 0,
    over500 = 0,
    max = 0;
  for (const [key, points] of groups) {
    if (points.size < 2) continue;
    multi++;
    const s = spread.get(key)!;
    const dy = ((Math.max(...s.lat) - Math.min(...s.lat)) / 1e6) * 111_195;
    const dx =
      ((Math.max(...s.lon) - Math.min(...s.lon)) / 1e6) *
      111_195 *
      Math.cos((40.5 * Math.PI) / 180);
    const meters = Math.hypot(dx, dy);
    if (meters > 50) over50++;
    if (meters > 500) over500++;
    max = Math.max(max, Math.round(meters));
  }
  return {
    addressGroups: groups.size,
    withMoreThanOnePoint: multi,
    spreadOver50m: over50,
    spreadOver500m: over500,
    maxSpreadMeters: max,
  };
})();

const measured = {
  rows: rows.length,
  pointAmbiguity,
  countyCounts,
  report,
  size: {
    indexBytes: bytes,
    gzipBytes: gzip,
    brotliBytes: brotli,
    rawBytes: Buffer.byteLength(rawText),
  },
  indexSha256: sha256(text),
  timings,
};
console.log(JSON.stringify(measured, null, 1));
writeFileSync(
  outFile.replace(/\.json$/, ".measurements.json"),
  JSON.stringify(measured, null, 1) + "\n",
);

if (manifestFile) {
  const pin = {
    schemaVersion: 1,
    kind: "address-index-prototype",
    id: "mclean-address-index",
    testOnly: false,
    scope:
      "PROTOTYPE INPUT PIN ONLY. It records which fetched county address bytes and which transform produced which index, so a later review can reproduce them. It is not a rights approval, not an owner approval of any dataset composition and not a publication approval, and no default or public build contains this index. Only an explicitly opt-in REVIEW build (TRAIL_ADDRESS_INDEX_FILE, review channel only, bytes equal to the pin below) can carry the real index, and the place chooser then fetches it only when a rider types an address; publication and composition approval are still absent.",
    source: {
      item: fetchManifest.item,
      service: fetchManifest.service,
      license: {
        name: "Creative Commons Attribution 4.0 International",
        url: "https://creativecommons.org/licenses/by/4.0/",
        statedBy:
          "the licenseInfo of the item above, checked on the retrieval date",
        attribution:
          "Contains McLean County, Illinois address data from the county's public 'Addresses' ArcGIS item (502eefa828f94f749bbab9da63b0d016), licensed CC BY 4.0. Trail Mapper reduced it to address text, postal community, postal code and point, normalized the text, rounded points to 1e-6 degrees and removed non-McLean and unnumbered rows. This is not the county's own product and is not endorsed by the county.",
        changesMade:
          "reduced fields; address text upper-cased with punctuation removed and directional and street-type words made canonical; points rounded to 1e-6 degrees; rows outside McLean County, without a leading house number, without a point, or exact duplicates removed (counts below)",
      },
      retrievedAt: fetchManifest.retrievedAt,
      completeness: fetchManifest.completeness,
      raw: fetchManifest.rawFile,
      fetcher: "webApp/tools/fetch-mcgis-addresses.mjs",
    },
    transform: {
      version: TRANSFORM_VERSION,
      schema: ADDRESS_INDEX_SCHEMA,
      code: "webApp/src/addressIndex.ts (buildAddressIndex, serializeAddressIndex), driven by webApp/tools/build-address-index.mts",
      coordinateScale: 1_000_000,
      deterministic:
        "verified at build time: the same rows in reverse order give the identical index bytes",
      countyFilter: "County equals MCLEAN COUNTY (case-insensitive)",
      countyCounts,
      report,
    },
    index: {
      bytes,
      gzipBytes: gzip,
      brotliBytes: brotli,
      sha256: sha256(text),
    },
    notIncluded: [
      "staff user and edit-date fields",
      "any personal route, position, or typed text",
      "owner or property data other than the address text and point",
    ],
    blockers: [
      "No Trail Mapper owner approval to ship this index in a build. That is an internal composition approval and is separate from the source's CC BY 4.0 label; a shipped build must carry the attribution and change statement above.",
      "Address points are not approved trail entrances; the no-gap Start rule is unchanged.",
    ],
    operationalUnknowns: [
      "Availability and rate tolerance of the county service for repeated bulk queries is unknown. It is an operational question, not a missing licence permission for the already downloaded, CC BY-labelled bytes.",
      "Currency of the rows: the item was last modified 2022-09-06; whether the rows are newer is not established.",
    ],
  };
  mkdirSync(dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, JSON.stringify(pin, null, 2) + "\n");
  console.log(`pin manifest ${manifestFile}`);
}
