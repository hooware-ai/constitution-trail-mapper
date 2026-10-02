// Read-only evidence of ACCESS-DELIVERY equivalence: lazy hash-verified tile loading plans exactly what loading every
// access road up front plans, on the REAL native county and access assets. This is NOT a native parity measurement:
// the trail network here is the county-only Existing configuration (no reviewed OpenStreetMap additions, no Proposed),
// and the question answered is only "does delivering the roads in tiles change any answer?".
//
// Two separate instances of the shared Kotlin core are compared. The reference is initialized with the whole access file
// (how native loads it). The lazy side is initialized with only the base roads and uses an AccessSession that loads
// service-road tiles around each operation's endpoints; its session stays warm across all plans (tiles accumulate), as in
// a page that has been open. Every public-catalog pair and catalog loop is planned on both and the full responses are
// compared. Then each routed result is re-checked as a RESTORED RIDE: a brand-new core instance and a brand-new loader
// (nothing loaded but the base roads) inspects the saved route through its session, and the verdict must equal the
// reference's. Nothing is written, served or committed.
//
//   npx tsx tools/access-equivalence.mjs [--json]
//
// Needs the built core (npm run build:core) and the ignored native assets (TRAIL_NATIVE_DIR overrides their directory).
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot, webRoot } from "./lib/core.mjs";
import { buildAccessParts } from "./lib/access-package.mjs";
import { AccessLoader, AccessSession } from "../src/accessTiles.ts";

const nativeDir = resolve(
  process.env.TRAIL_NATIVE_DIR ??
    join(webRoot, "..", "..", "Constitution Trail Mapper", "data", "generated"),
);
const corePath = join(
  repoRoot,
  "webBridge",
  "build",
  "dist",
  "js",
  "productionLibrary",
  "TrailMapper-webBridge.mjs",
);
const instance = async (n) => {
  const module = await import(`${pathToFileURL(corePath).href}?instance=${n}`);
  return (request) => JSON.parse(module.dispatch(JSON.stringify(request)));
};
const NOW = Date.parse("2026-10-01T15:00:00Z");

const county = JSON.parse(
  await readFile(join(nativeDir, "mcgis-trails.normalized.json"), "utf8"),
);
county.layers = county.layers.map((layer) => ({
  ...layer,
  features: layer.features.filter((feature) => feature.status === "Existing"),
}));
const trails = JSON.stringify(county);
const accessText = (
  await readFile(join(nativeDir, "mclean-access-roads.normalized.json"), "utf8")
).replace(/^﻿/, "");

const searchSource = await readFile(join(webRoot, "src", "search.ts"), "utf8");
const places = [
  ...searchSource.matchAll(
    /label:\s*"([^"]+)",[\s\S]*?latitude:\s*(-?[\d.]+),\s*longitude:\s*(-?[\d.]+)/g,
  ),
].map(([, label, latitude, longitude]) => ({
  label,
  latitude: Number(latitude),
  longitude: Number(longitude),
}));

const reference = await instance(1);
const referenceInit = reference({
  op: "initialize",
  trails,
  access: accessText,
  now: NOW,
});
if (referenceInit.ok === false) throw new Error(referenceInit.error);

const built = buildAccessParts(accessText);
const files = new Map(built.files.map((f) => [f.file, f.body]));
const lazy = await instance(2);
const fetched = [];
const loader = new AccessLoader(built.descriptor, {
  async fetchBytes(file) {
    const body = files.get(file);
    if (!body) throw new Error(`missing ${file}`);
    return new Uint8Array(body).buffer;
  },
  async sha256Hex(bytes) {
    return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  },
  dispatch: lazy,
});
const lazyInit = lazy({
  op: "initialize",
  trails,
  access: await loader.baseText(),
  now: NOW,
});
if (lazyInit.ok === false) throw new Error(lazyInit.error);
const session = new AccessSession(loader, lazy);

const requests = [];
for (let i = 0; i < places.length; i++)
  for (let j = i + 1; j < places.length; j++)
    requests.push({
      name: `${places[i].label} -> ${places[j].label}`,
      request: {
        op: "plan",
        start: places[i],
        destination: places[j],
        proposed: false,
        now: NOW,
      },
    });
for (const place of places)
  for (const miles of [3, 8])
    requests.push({
      name: `${place.label} loop ${miles} mi`,
      request: { op: "plan", start: place, miles, proposed: false, now: NOW },
    });

// A cold restored ride: new core instance, new loader, base roads only, then the session loads what the route needs.
let coldInstances = 100;
async function coldInspect(route) {
  const call = await instance(++coldInstances);
  const coldLoader = new AccessLoader(built.descriptor, {
    fetchBytes: async (file) => new Uint8Array(files.get(file)).buffer,
    sha256Hex: async (bytes) =>
      createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
    dispatch: call,
  });
  const init = call({
    op: "initialize",
    trails,
    access: await coldLoader.baseText(),
    now: NOW,
  });
  if (init.ok === false) throw new Error(init.error);
  const cold = new AccessSession(coldLoader, call);
  return {
    verdict: await cold.run({ op: "inspect", route, now: NOW }),
    tiles: coldLoader.loadedCells.length,
  };
}

const rows = [];
let restored = 0;
let coldTiles = 0;
for (const { name, request } of requests) {
  const expected = reference(request);
  const actual = await session.run(request);
  const same = JSON.stringify(expected) === JSON.stringify(actual);
  rows.push({
    name,
    same,
    routed: Boolean(expected.route),
    navigable: Boolean(expected.canNavigate),
  });
  if (expected.route) {
    const cold = await coldInspect(expected.route);
    const referenceCheck = reference({
      op: "inspect",
      route: expected.route,
      now: NOW,
    });
    restored++;
    coldTiles += cold.tiles;
    if (JSON.stringify(cold.verdict) !== JSON.stringify(referenceCheck))
      rows.push({
        name: `${name} (cold restored ride)`,
        same: false,
        routed: true,
        navigable: false,
      });
  }
}
const mismatches = rows.filter((row) => !row.same);
const summary = {
  requests: requests.length,
  routed: rows.filter((r) => r.routed).length,
  navigable: rows.filter((r) => r.navigable).length,
  coldRestoredRides: restored,
  coldRestoredTilesLoaded: coldTiles,
  mismatches: mismatches.map((m) => m.name),
  tilesLoaded: loader.loadedCells.length,
  tilesInPackage: built.tiles.length,
  bytesFetched: loader.fetched.reduce((n, f) => n + f.bytes, 0),
  bytesInPackage: built.files.reduce((n, f) => n + f.body.length, 0),
};
if (process.argv.includes("--json"))
  console.log(JSON.stringify(summary, null, 2));
else {
  console.log(
    `Access-delivery equivalence, county-only Existing configuration (not native parity): ${summary.requests} plans (pairs and loops), ${summary.routed} routed, ${summary.navigable} navigable; ${summary.coldRestoredRides} cold restored rides checked (${summary.coldRestoredTilesLoaded} tiles loaded across them).`,
  );
  console.log(
    `Mismatches between lazy and whole-file loading: ${summary.mismatches.length}${summary.mismatches.length ? ` (${summary.mismatches.join("; ")})` : ""}.`,
  );
  console.log(
    `Lazy side loaded ${summary.tilesLoaded} of ${summary.tilesInPackage} tiles, ${(summary.bytesFetched / 1024).toFixed(0)} KB of ${(summary.bytesInPackage / 1024).toFixed(0)} KB raw.`,
  );
}
process.exit(summary.mismatches.length ? 1 : 0);
