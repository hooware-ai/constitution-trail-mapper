// Fetches the McLean County address points for the address-index PROTOTYPE. Read-only and unauthenticated: it only issues
// public GET queries to the county's public ArcGIS service and never signs in, accepts terms, uses a token or writes to any
// server. It asks for the minimum the index needs (address text, building, unit, postal community, postal code, municipality,
// county, state and the point geometry), never the staff user or edit-date fields, and writes ONLY to the ignored
// data/generated directory.
//
//   node tools/fetch-mcgis-addresses.mjs [--out <raw.json>] [--pause <ms>]
//
// Source (primary item and service, checked when this is run, and recorded in the output manifest):
//   item     https://www.arcgis.com/sharing/rest/content/items/502eefa828f94f749bbab9da63b0d016  ("Addresses", Feature Service)
//   service  https://www.mcgisweb.org/mcgc/rest/services/OpenData/OpenData/MapServer/0
// Completeness: the total comes from a count query; records are fetched in OBJECTID windows smaller than the service's
// maxRecordCount, every window must be complete (no exceededTransferLimit), and the sum must equal the count and the number
// of distinct ids. Anything else fails the run: there is no partial, "first 1000" result.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
export const ITEM_ID = "502eefa828f94f749bbab9da63b0d016";
export const ITEM_URL = `https://www.arcgis.com/sharing/rest/content/items/${ITEM_ID}?f=json`;
export const SERVICE_URL =
  "https://www.mcgisweb.org/mcgc/rest/services/OpenData/OpenData/MapServer/0";
export const FIELDS = [
  "OBJECTID_1",
  "ADDRESS",
  "Building",
  "Unit",
  "Post_Comm",
  "Post_Code",
  "Inc_Muni",
  "County",
  "State",
];
const USER_AGENT =
  "TrailMapperAddressPrototype/1.0 (read-only public queries; guest-first trail routing research)";
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const outFile = resolve(
  arg("--out") ??
    join(repoRoot, "data", "generated", "mcgis-addresses.raw.json"),
);
const pause = Number(arg("--pause") ?? 250);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// The exact bytes of every metadata response are kept, so what the item and layer said can be reviewed later.
const sources = new Map();
async function getJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const value = JSON.parse(text);
      if (value.error)
        throw new Error(`service error ${JSON.stringify(value.error)}`);
      sources.set(url, text);
      return value;
    } catch (error) {
      if (attempt === 4) throw new Error(`${url}: ${error.message}`);
      await sleep(1500 * attempt);
    }
  }
}
const query = (params) =>
  getJson(
    `${SERVICE_URL}/query?${new URLSearchParams({ f: "json", ...params })}`,
  );

const item = await getJson(ITEM_URL);
if (item.id !== ITEM_ID)
  throw new Error("The item metadata is not the pinned item.");
if (!/creativecommons\.org\/licenses\/by\/4\.0/.test(item.licenseInfo ?? ""))
  throw new Error(
    "The item no longer states CC BY 4.0: stop and review before using it.",
  );
// The item must describe exactly the service layer this tool queries (a reproducibility guard: the licence statement
// applies to the item, so the item and the queried layer must be the same thing).
const sameUrl = (a, b) =>
  String(a ?? "")
    .replace(/\/+$/, "")
    .toLowerCase() ===
  String(b ?? "")
    .replace(/\/+$/, "")
    .toLowerCase();
if (!sameUrl(item.url, SERVICE_URL))
  throw new Error(
    `The item's service URL (${item.url}) is not the pinned service (${SERVICE_URL}): stop and review.`,
  );
const layer = await getJson(`${SERVICE_URL}?f=json`);
const maxRecordCount = layer.maxRecordCount;
const retrievedAt = new Date().toISOString();
const { count } = await query({ where: "1=1", returnCountOnly: "true" });
const range = (
  await query({
    where: "1=1",
    outStatistics: JSON.stringify([
      {
        statisticType: "min",
        onStatisticField: "OBJECTID_1",
        outStatisticFieldName: "lo",
      },
      {
        statisticType: "max",
        onStatisticField: "OBJECTID_1",
        outStatisticFieldName: "hi",
      },
    ]),
  })
).features[0].attributes;
console.log(
  `item "${item.title}" (${item.type}), owner ${item.owner}, modified ${new Date(item.modified).toISOString()}`,
);
console.log(
  `service layer "${layer.name}", maxRecordCount ${maxRecordCount}; count ${count}; OBJECTID_1 ${range.lo}..${range.hi}`,
);

const window = Math.floor(maxRecordCount * 0.75); // ids per window: always fewer records than the service will return
const rows = [];
const windows = [];
for (let lo = range.lo; lo <= range.hi; lo += window) {
  const hi = lo + window - 1;
  const page = await query({
    where: `OBJECTID_1 >= ${lo} AND OBJECTID_1 <= ${hi}`,
    outFields: FIELDS.join(","),
    returnGeometry: "true",
    outSR: "4326",
    orderByFields: "OBJECTID_1",
  });
  if (page.exceededTransferLimit)
    throw new Error(
      `Window ${lo}..${hi} exceeded the transfer limit: not complete.`,
    );
  for (const f of page.features) {
    const a = f.attributes;
    rows.push([
      a.OBJECTID_1,
      a.ADDRESS ?? null,
      a.Building ?? null,
      a.Unit ?? null,
      a.Post_Comm ?? null,
      a.Post_Code ?? null,
      a.Inc_Muni ?? null,
      a.County ?? null,
      a.State ?? null,
      f.geometry ? f.geometry.x : null,
      f.geometry ? f.geometry.y : null,
    ]);
  }
  windows.push([lo, hi, page.features.length]);
  process.stdout.write(`\r${rows.length}/${count}`);
  await sleep(pause);
}
process.stdout.write("\n");
rows.sort((a, b) => a[0] - b[0]);
const distinct = new Set(rows.map((r) => r[0])).size;
if (rows.length !== count || distinct !== count)
  throw new Error(
    `Incomplete: fetched ${rows.length} rows, ${distinct} distinct ids, service count ${count}.`,
  );
const withoutPoint = rows.filter((r) => r[9] == null || r[10] == null).length;

const raw = JSON.stringify({
  schema: "trail-mapper.address-points.raw/1",
  columns: [...FIELDS, "x", "y"],
  rows,
});
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, raw);
const itemText = sources.get(ITEM_URL);
const layerText = sources.get(`${SERVICE_URL}?f=json`);
writeFileSync(outFile.replace(/\.json$/, ".item.json"), itemText);
writeFileSync(outFile.replace(/\.json$/, ".layer.json"), layerText);
const manifest = {
  schema: "trail-mapper.address-points.fetch/1",
  retrievedAt,
  item: {
    id: item.id,
    title: item.title,
    type: item.type,
    owner: item.owner,
    url: `https://www.arcgis.com/home/item.html?id=${ITEM_ID}`,
    modified: new Date(item.modified).toISOString(),
    snippet: item.snippet,
    access: item.access,
    serviceUrl: item.url,
    // The licence statement exactly as the item publishes it (HTML, unedited).
    licenseInfo: item.licenseInfo,
    accessInformation: item.accessInformation ?? null,
    itemJsonSha256: sha256(itemText),
  },
  service: {
    url: SERVICE_URL,
    name: layer.name,
    maxRecordCount,
    outSR: 4326,
    fields: FIELDS,
    copyrightText: layer.copyrightText ?? null,
    description: layer.description ?? null,
    layerJsonSha256: sha256(layerText),
  },
  completeness: {
    serviceCount: count,
    fetchedRows: rows.length,
    distinctIds: distinct,
    objectIdRange: [range.lo, range.hi],
    windowIds: window,
    windows: windows.length,
    rowsWithoutPoint: withoutPoint,
    transferLimitHit: false,
  },
  rawFile: { bytes: Buffer.byteLength(raw), sha256: sha256(raw) },
};
writeFileSync(
  outFile.replace(/\.json$/, ".fetch.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest.completeness));
console.log(
  `raw ${manifest.rawFile.bytes} bytes sha256 ${manifest.rawFile.sha256}`,
);
console.log(`wrote ${outFile}`);
