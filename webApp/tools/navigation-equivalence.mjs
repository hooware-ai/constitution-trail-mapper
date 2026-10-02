// Read-only classification of WHY routes are or are not navigable, on the real native assets, with the shared Kotlin core.
//
// Two separate questions are kept apart:
//   1. Does the core find a route at all (route availability)?
//   2. May the rider START navigation on it? Native enables "Start navigation" whenever no blocking closure applies
//      (androidApp TrailRouteMapActivity: enabled = closureBlock == null); estimated (dotted) access gaps only change the
//      message. The web additionally refuses routes with estimated access gaps, Proposed trails, or a network that is not
//      current ("unverified connections are never navigable"). The difference is therefore a POLICY difference, and this
//      tool reports it per route instead of folding it into a single number.
//
// It also runs positive controls (trail vertex to trail vertex, no road access needed: navigable on both rules) and
// negative controls (an endpoint with no mapped way to the network: native-startable but web-blocked, with the gap
// measured). Nothing is written, served or committed.
//
//   node tools/navigation-equivalence.mjs [--json]
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot, webRoot } from "./lib/core.mjs";

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
const core = await import(pathToFileURL(corePath).href);
const call = (request) => JSON.parse(core.dispatch(JSON.stringify(request)));
// Each plan on the full county and access data costs several seconds, so the control sample is small and seeded.
const CONTROL_PAIRS = Number(process.env.NAV_CONTROL_PAIRS ?? 12);
const NOW = Date.parse("2026-10-01T15:00:00Z");
const read = async (name) =>
  JSON.parse((await readFile(join(nativeDir, name), "utf8")).replace(/^﻿/, ""));

const county = await read("mcgis-trails.normalized.json");
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

const existing = {
  ...county,
  layers: county.layers.map((layer) => ({
    ...layer,
    features: layer.features.filter((f) => f.status === "Existing"),
  })),
};

// Seeded pseudo-random so the controls are reproducible.
let seed = 20261001;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const vertices = existing.layers
  .flatMap((layer) => layer.features)
  .flatMap((f) => f.paths.flatMap((path) => [path[0], path[path.length - 1]]))
  .map(([longitude, latitude]) => ({ latitude, longitude }));

const rad = Math.PI / 180;
const distanceMeters = (a, b) =>
  Math.hypot(
    (b.longitude - a.longitude) *
      Math.cos(((a.latitude + b.latitude) / 2) * rad),
    b.latitude - a.latitude,
  ) * 111320;
/** Distance from a point to the nearest piece of a set of polylines, in metres (equirectangular, fine at county scale). */
function nearestMeters(point, segments) {
  let best = Infinity;
  const cos = Math.cos(point.latitude * rad);
  for (const [a, b] of segments) {
    const ax = (a[0] - point.longitude) * cos;
    const ay = a[1] - point.latitude;
    const bx = (b[0] - point.longitude) * cos;
    const by = b[1] - point.latitude;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length
      ? Math.max(0, Math.min(1, (-ax * dx - ay * dy) / length))
      : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy) * 111320);
  }
  return best;
}
const segmentsOf = (features) =>
  features.flatMap((f) =>
    f.paths.flatMap((path) => path.slice(1).map((q, i) => [path[i], q])),
  );
const trailSegments = segmentsOf(existing.layers.flatMap((l) => l.features));
const roadSegments = segmentsOf(
  JSON.parse(accessText).layers.flatMap((l) => l.features),
);

const classify = (r) => {
  const gaps = r.accessGaps ?? [];
  const blockingClosure = (r.closures ?? []).length > 0;
  const routeExists = Boolean(r.route);
  const webStartable = routeExists && r.canNavigate === true;
  // Native: a route can be started unless a blocking closure applies (estimated access only changes the message).
  const nativeStartable = routeExists && !blockingClosure;
  const reasons = [];
  if (routeExists && !webStartable) {
    if (gaps.length) reasons.push("estimated-access-gap");
    if (r.proposed) reasons.push("proposed-trail");
    if (blockingClosure) reasons.push("blocking-closure");
    if (r.network && !["current", "trusted"].includes(r.network.status))
      reasons.push("network-not-current");
  }
  return {
    routeExists,
    webStartable,
    nativeStartable,
    reasons,
    gapMeters: Math.round(
      gaps.reduce((n, g) => n + (g.distanceMeters ?? g.meters ?? 0), 0),
    ),
    gapCount: gaps.length,
  };
};

const summarize = (rows) => {
  const out = {
    plans: rows.length,
    coreRoutes: rows.filter((r) => r.routeExists).length,
    nativeStartable: rows.filter((r) => r.nativeStartable).length,
    webStartable: rows.filter((r) => r.webStartable).length,
    webBlockedButNativeStartable: rows.filter(
      (r) => r.nativeStartable && !r.webStartable,
    ).length,
    webBlockedReasons: {},
  };
  for (const row of rows)
    for (const reason of row.reasons)
      out.webBlockedReasons[reason] = (out.webBlockedReasons[reason] ?? 0) + 1;
  return out;
};

const configs = {
  "web data (county Existing) + access": {
    trails: existing,
    access: accessText,
  },
  "native data (county 260, default layers) + access": {
    trails: county,
    access: accessText,
  },
};

const report = { configs: {} };
for (const [name, config] of Object.entries(configs)) {
  const init = call({
    op: "initialize",
    trails: JSON.stringify(config.trails),
    access: config.access,
    now: NOW,
  });
  if (init.ok === false) throw new Error(init.error);
  console.error(`configuration: ${name}`);
  const plan = (start, destination) =>
    call({ op: "plan", start, destination, proposed: false, now: NOW });

  // 1. Catalog pairs: the questions a rider actually asks.
  const catalog = [];
  for (let i = 0; i < places.length; i++)
    for (let j = i + 1; j < places.length; j++)
      catalog.push(classify(plan(places[i], places[j])));

  // 2. Positive controls: trail vertex to trail vertex.
  const trailPairs = [];
  seed = 20261001;
  for (let k = 0; k < CONTROL_PAIRS; k++) {
    const a = vertices[Math.floor(random() * vertices.length)];
    const b = vertices[Math.floor(random() * vertices.length)];
    if (a === b) continue;
    trailPairs.push({ a, b, ...classify(plan(a, b)) });
  }
  const positive = trailPairs.filter((p) => p.routeExists && p.webStartable);

  // 3. Negative controls: an endpoint displaced due north from the first trail vertex by a fixed number of degrees. The
  // displacement is what was CHOSEN; what it means for the network is MEASURED here, against the trail geometry and the
  // access roads actually loaded, and reported apart from the estimated access gap the router then draws.
  const negatives = [];
  for (const offsetDegrees of [0.003, 0.0095]) {
    const a = vertices[0];
    const off = {
      latitude: a.latitude + offsetDegrees,
      longitude: a.longitude,
    };
    const result = classify(plan(off, vertices[1]));
    negatives.push({
      northwardOffsetDegrees: offsetDegrees,
      offsetFromSelectedVertexMeters: Math.round(distanceMeters(off, a)),
      nearestTrailMeters: Math.round(nearestMeters(off, trailSegments)),
      nearestAccessRoadMeters: Math.round(nearestMeters(off, roadSegments)),
      ...result,
    });
  }

  report.configs[name] = {
    catalogPairs: summarize(catalog),
    trailVertexPairs: {
      ...summarize(trailPairs),
      example: positive.slice(0, 3).map((p) => ({
        from: p.a,
        to: p.b,
      })),
    },
    negatives,
  };
}

if (process.argv.includes("--json"))
  console.log(JSON.stringify(report, null, 2));
else
  for (const [name, config] of Object.entries(report.configs)) {
    console.log(`\n${name}`);
    for (const [label, s] of [
      ["catalog pairs", config.catalogPairs],
      ["trail vertex pairs", config.trailVertexPairs],
    ])
      console.log(
        `  ${label}: ${s.plans} plans; core route ${s.coreRoutes}; native could start ${s.nativeStartable}; web can start ${s.webStartable}; web blocked but native startable ${s.webBlockedButNativeStartable}; web reasons ${JSON.stringify(s.webBlockedReasons)}`,
      );
    for (const n of config.negatives)
      console.log(
        `  negative (endpoint ${n.northwardOffsetDegrees} deg north of a trail vertex = ${n.offsetFromSelectedVertexMeters} m from that vertex; measured ${n.nearestTrailMeters} m from the nearest trail and ${n.nearestAccessRoadMeters} m from the nearest access road): core route ${n.routeExists}; native startable ${n.nativeStartable}; web startable ${n.webStartable}; reasons ${n.reasons.join(",") || "none"}; estimated access gap ${n.gapMeters} m in ${n.gapCount} segment(s)`,
      );
  }
