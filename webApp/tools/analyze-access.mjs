// Read-only sizing of the access package for a real extract: what opening the planner downloads (base roads), what a
// trip downloads (index plus the tiles around its endpoints), and how that compares with the whole package. Packages in
// memory only; nothing is written, served or committed.
//
//   node tools/analyze-access.mjs [--input <access-extract.json>] [--json]
//
// Default input is the native checkout's ignored access asset (TRAIL_NATIVE_DIR overrides its directory).
import { readFile } from "node:fs/promises";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { join, resolve } from "node:path";
import { webRoot } from "./lib/core.mjs";
import { buildAccessParts, cellOf } from "./lib/access-package.mjs";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const nativeDir = resolve(
  process.env.TRAIL_NATIVE_DIR ??
    join(webRoot, "..", "..", "Constitution Trail Mapper", "data", "generated"),
);
const input =
  arg("--input") ?? join(nativeDir, "mclean-access-roads.normalized.json");
const text = await readFile(input, "utf8");
const built = buildAccessParts(text);
const size = (buffer) => ({
  raw: buffer.length,
  gzip: gzipSync(buffer, { level: 9 }).length,
  brotli: brotliCompressSync(buffer, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length,
});
const sum = (list) =>
  list.reduce(
    (total, item) => ({
      raw: total.raw + item.raw,
      gzip: total.gzip + item.gzip,
      brotli: total.brotli + item.brotli,
    }),
    { raw: 0, gzip: 0, brotli: 0 },
  );
const tileSizes = built.tiles.map((tile) => ({
  ...size(tile.body),
  lat: tile.lat,
  lon: tile.lon,
  features: tile.featureCount,
}));

// A trip: a 3x3 block of cells around each of two endpoints (the study area's extremes and a middle point).
const byCell = new Map(tileSizes.map((t) => [`${t.lat}_${t.lon}`, t]));
const tripCost = (a, b) => {
  const wanted = new Map();
  for (const [lat, lon] of [a, b].map(([la, lo]) => cellOf(la, lo)))
    for (let dLat = -1; dLat <= 1; dLat++)
      for (let dLon = -1; dLon <= 1; dLon++) {
        const tile = byCell.get(`${lat + dLat}_${lon + dLon}`);
        if (tile) wanted.set(`${tile.lat}_${tile.lon}`, tile);
      }
  const tiles = [...wanted.values()];
  return { tiles: tiles.length, ...sum(tiles) };
};
const sampleTrips = {
  "middle to middle": [
    [40.5, -88.95],
    [40.48, -88.92],
  ],
  "north-west to south-east": [
    [40.58, -89.15],
    [40.42, -88.92],
  ],
};
const report = {
  input,
  base: { features: built.base.featureCount, ...size(built.base.body) },
  index: { tiles: built.tiles.length, ...size(built.index.body) },
  localFeatures: built.descriptor.index.localFeatureCount,
  tileAssignments: built.descriptor.index.tileAssignments,
  tiles: {
    count: tileSizes.length,
    ...sum(tileSizes),
    largestRaw: Math.max(0, ...tileSizes.map((t) => t.raw)),
    medianRaw:
      [...tileSizes].map((t) => t.raw).sort((a, b) => a - b)[
        Math.floor(tileSizes.length / 2)
      ] ?? 0,
  },
  originalRaw: Buffer.byteLength(text),
  trips: Object.fromEntries(
    Object.entries(sampleTrips).map(([name, [a, b]]) => [name, tripCost(a, b)]),
  ),
};
if (process.argv.includes("--json"))
  console.log(JSON.stringify(report, null, 2));
else {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const row = (label, s) =>
    console.log(
      `${label.padEnd(34)} raw ${kb(s.raw).padStart(11)}  gzip ${kb(s.gzip).padStart(11)}  brotli ${kb(s.brotli).padStart(11)}`,
    );
  console.log(`Input ${input} (${kb(report.originalRaw)})`);
  row(`base roads (${report.base.features})`, report.base);
  row(`tile index (${report.index.tiles} tiles)`, report.index);
  row(`all tiles (${report.tiles.count})`, report.tiles);
  for (const [name, cost] of Object.entries(report.trips))
    row(`trip ${name} (${cost.tiles} tiles)`, cost);
  console.log(
    `Opening the planner: base only. Local service roads ${report.localFeatures}; tile assignments ${report.tileAssignments} (duplication from whole-feature assignment).`,
  );
}
