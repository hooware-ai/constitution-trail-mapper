// NOTE ON "navigable": the probe reports two things apart. A route is AVAILABLE when the core found one. The web
// additionally decides whether the rider may START navigation on it (no estimated access gap, no Proposed trail, a
// current network, no blocking closure), which is stricter than native (native refuses only for a blocking closure).
// Counts named `navigable` below are the WEB start rule; `startBlockedBy` gives the reason, and
// tools/navigation-equivalence.mjs classifies both rules side by side. Zero navigable never means the core found no route.
//
// Native-to-web data parity probe. READ-ONLY and private: it reads native's generated (git-ignored) routing assets and the
// web's public place catalog, drives the REAL shared Kotlin routing core in-process, and reports what each data
// configuration can do. It never writes the assets, never uses a network, and its output is evidence for
// docs/web/native-parity.md, not a build input.
//
//   node tools/parity-probe.mjs [--json]
//   TRAIL_NATIVE_DIR=<native checkout>/data/generated   (default: ../Constitution Trail Mapper/data/generated)
//
// Configurations (each is the SAME core and the same planner request; only the data differs):
//   web      what the web county package ships: the 254 Existing county features
//   +proposed the 6 Proposed county features added to the network (they stay opt-in: requests below never enable them)
//   +osm      the 4 reviewed OpenStreetMap ways added
//   +access   the native access network (TIGER local roads + endpoint-local OSM service roads) added
//   native    all of the above = what native loads
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./lib/core.mjs";

// SHA-256 of the three native generated assets as recorded on 2026-10-01 (built into the local debug APK of Sept 27).
const EXPECTED = {
  "mcgis-trails.normalized.json":
    "310f1d50326a207ea22eb05cda78759bc62d1c4df55bd0515f6608f974b8b3a8",
  "verified-trail-additions.normalized.json":
    "2f97e23b5d6dae09be245772c9cfebfab13c44fe71df6a60a6d93a63797ae317",
  "mclean-access-roads.normalized.json":
    "23a9719dd45297352cef641014697ca0b263184af9fdace48573b0d6ba264d07",
};
const dir = resolve(
  process.env.TRAIL_NATIVE_DIR ??
    join(repoRoot, "..", "Constitution Trail Mapper", "data", "generated"),
);
if (!existsSync(dir))
  throw new Error(`Native assets not found at ${dir} (set TRAIL_NATIVE_DIR).`);
const raw = {};
const hashes = {};
for (const [name, expected] of Object.entries(EXPECTED)) {
  raw[name] = await readFile(join(dir, name), "utf8");
  hashes[name] = {
    sha256: createHash("sha256").update(raw[name]).digest("hex"),
    bytes: Buffer.byteLength(raw[name]),
  };
  hashes[name].matchesRecorded = hashes[name].sha256 === expected;
}
const county = JSON.parse(raw["mcgis-trails.normalized.json"]);
const osm = JSON.parse(raw["verified-trail-additions.normalized.json"]);
const access = JSON.parse(raw["mclean-access-roads.normalized.json"]);

const withoutProposed = {
  ...county,
  layers: county.layers.map((layer) => ({
    ...layer,
    features: layer.features.filter((f) => f.status === "Existing"),
  })),
};
const counts = (layers) => {
  const out = { Existing: 0, Proposed: 0, other: 0 };
  for (const layer of layers)
    for (const f of layer.features) out[f.status in out ? f.status : "other"]++;
  return out;
};
const configs = {
  web: { trails: withoutProposed, access: null },
  "+proposed": { trails: county, access: null },
  "+osm": {
    trails: {
      ...withoutProposed,
      layers: [...withoutProposed.layers, ...osm.layers],
    },
    access: null,
  },
  "+access": { trails: withoutProposed, access },
  native: {
    trails: { ...county, layers: [...county.layers, ...osm.layers] },
    access,
  },
};

const core = await import(
  pathToFileURL(
    join(
      repoRoot,
      "webBridge",
      "build",
      "dist",
      "js",
      "productionLibrary",
      "TrailMapper-webBridge.mjs",
    ),
  ).href
);
const call = (request) => JSON.parse(core.dispatch(JSON.stringify(request)));
const NOW = Date.parse("2026-10-01T15:00:00Z");

// The web's public place catalog (the same list a rider chooses from), read from source without importing TypeScript.
const searchSource = await readFile(
  join(repoRoot, "webApp", "src", "search.ts"),
  "utf8",
);
const places = [
  ...searchSource.matchAll(
    /label:\s*"([^"]+)",[\s\S]*?latitude:\s*(-?[\d.]+),\s*longitude:\s*(-?[\d.]+)/g,
  ),
].map(([, label, latitude, longitude]) => ({
  label,
  latitude: Number(latitude),
  longitude: Number(longitude),
}));

const report = {
  dir,
  hashes,
  nativeCounts: {
    county: counts(county.layers),
    osm: osm.layers.flatMap((l) => l.features).length,
    accessFeatures: access.layers.map((l) => [l.id, l.features.length]),
  },
  places: places.length,
  configs: {},
};

for (const [name, config] of Object.entries(configs)) {
  const init = call({
    op: "initialize",
    trails: JSON.stringify(config.trails),
    ...(config.access ? { access: JSON.stringify(config.access) } : {}),
    trustSerializedRoutes: false,
    now: NOW,
  });
  if (init.ok === false) throw new Error(`${name}: ${init.error}`);
  const row = {
    features: init.featureCount,
    accessFeatures: init.accessFeatureCount,
    pairs: 0,
    routed: 0,
    navigable: 0,
    // Why the web refuses to start navigation on routes the core found (a route can have several reasons).
    startBlockedBy: {},
    withAccessGap: 0,
    accessMetersTotal: 0,
    trailMilesTotal: 0,
    loops: { asked: 0, found: 0, navigable: 0 },
    // A route the planner has JUST made must verify against the same network: anything else is a defect.
    freshRoutes: 0,
    freshRoutesFlaggedStale: 0,
    results: {},
  };
  for (let i = 0; i < places.length; i++)
    for (let j = i + 1; j < places.length; j++) {
      const a = places[i];
      const b = places[j];
      row.pairs++;
      const r = call({
        op: "plan",
        start: a,
        destination: b,
        proposed: false,
        now: NOW,
      });
      const key = `${a.label} -> ${b.label}`;
      if (r.ok === false || !r.route) {
        row.results[key] = "no route";
        continue;
      }
      row.routed++;
      row.freshRoutes++;
      if (r.network?.status === "stale") row.freshRoutesFlaggedStale++;
      const gaps = (r.accessGaps ?? []).length;
      if (r.canNavigate) row.navigable++;
      else
        for (const reason of [
          gaps ? "estimated-access-gap" : null,
          r.proposed ? "proposed-trail" : null,
          (r.closures ?? []).length ? "blocking-closure" : null,
          r.network && !["current", "trusted"].includes(r.network.status)
            ? "network-not-current"
            : null,
        ].filter(Boolean))
          row.startBlockedBy[reason] = (row.startBlockedBy[reason] ?? 0) + 1;
      if (gaps) row.withAccessGap++;
      row.accessMetersTotal += r.accessDistance ?? 0;
      row.trailMilesTotal += (r.distance ?? 0) / 1609.344;
      row.results[key] =
        `route found; web start ${r.canNavigate ? "allowed" : "refused"} ${(r.distance / 1609.344).toFixed(2)}mi access=${Math.round(r.accessDistance ?? 0)}m gaps=${gaps}`;
    }
  for (const place of places) {
    for (const miles of [3, 8]) {
      row.loops.asked++;
      const r = call({
        op: "plan",
        start: place,
        miles,
        proposed: false,
        now: NOW,
      });
      if (r.ok !== false && r.route) {
        row.loops.found++;
        row.freshRoutes++;
        if (r.network?.status === "stale") row.freshRoutesFlaggedStale++;
        if (r.canNavigate) row.loops.navigable++;
      }
    }
  }
  row.trailMilesTotal = Number(row.trailMilesTotal.toFixed(1));
  report.configs[name] = row;
}

// Targeted probes: a short loop started ON each reviewed OSM way and ON each Proposed segment. "found" means the core
// built a route from that start; "usesIt" means that route's edges include the feature. Proposed requests are made both
// without and with the explicit opt-in, because Proposed must stay opt-in.
const midpoint = (feature) => {
  const path = feature.paths.flat();
  const [longitude, latitude] = path[Math.floor(path.length / 2)];
  return { latitude, longitude };
};
const osmFeatures = osm.layers.flatMap((l) => l.features);
const proposedFeatures = county.layers
  .flatMap((l) => l.features)
  .filter((f) => f.status === "Proposed");
report.targeted = {};
for (const [name, config] of Object.entries(configs)) {
  call({
    op: "initialize",
    trails: JSON.stringify(config.trails),
    ...(config.access ? { access: JSON.stringify(config.access) } : {}),
    trustSerializedRoutes: false,
    now: NOW,
  });
  const probe = (feature, miles, proposed) => {
    const r = call({
      op: "plan",
      start: midpoint(feature),
      miles,
      proposed,
      now: NOW,
    });
    if (r.ok === false || !r.route) return "no route";
    const edges = r.route.edges ?? [];
    const uses = edges.some((e) =>
      String(e.sourceFeatureId ?? "").includes(
        String(feature.id ?? feature.wayId),
      ),
    );
    return `found ${(r.distance / 1609.344).toFixed(2)}mi${uses ? " usesIt" : ""}${r.canNavigate ? " navigable" : " blocked"}`;
  };
  report.targeted[name] = {
    osm: Object.fromEntries(
      osmFeatures.map((f) => [f.name ?? f.id, probe(f, 2, false)]),
    ),
    proposedOptOut: Object.fromEntries(
      proposedFeatures.map((f) => [f.id, probe(f, 2, false)]),
    ),
    proposedOptIn: Object.fromEntries(
      proposedFeatures.map((f) => [f.id, probe(f, 2, true)]),
    ),
  };
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("assets:", JSON.stringify(hashes, null, 2));
  console.log("native counts:", JSON.stringify(report.nativeCounts));
  console.log(`places: ${places.length}`);
  for (const [name, row] of Object.entries(report.configs)) {
    const { results, ...summary } = row;
    console.log(`\n== ${name}`, JSON.stringify(summary));
  }
}
