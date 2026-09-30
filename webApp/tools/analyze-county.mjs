// Drives the real Kotlin routing core over the packaged county network and reports what it can and cannot do.
//
//   node tools/analyze-county.mjs [--json]           (reads webApp/generated/county, or TRAIL_COUNTY_DIR)
//
// Coverage and connectivity (which reviewed trails actually join, how much of the network the largest connected part
// holds), representative point-to-point, loop and disconnected-pair cases, saved-route revalidation of every route it
// makes, and closure interaction. Everything runs in-process on the verified package: no network, no browser, and no
// street access data, so a "disconnected" result means exactly "not joined by the reviewed trails".
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { repoRoot } from "./lib/core.mjs";
import { verifyPackageDir } from "./lib/dataset-package.mjs";

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
const { record, body } = await verifyPackageDir();
const call = (request) => JSON.parse(core.dispatch(JSON.stringify(request)));
const NOW = Date.parse(
  process.env.TRAIL_ANALYSIS_NOW ?? "2026-09-30T15:00:00Z",
);
const init = call({
  op: "initialize",
  trails: body.toString("utf8"),
  dataset: {
    kind: "county",
    id: record.id,
    version: record.version,
    contentSha256: record.content.sha256,
  },
  trustSerializedRoutes: false,
  now: NOW,
});
if (init.ok === false) throw new Error(init.error);

const network = JSON.parse(body.toString("utf8"));
const features = network.layers[0].features;
const metersBetween = (a, b) => {
  const r = 6371008.8,
    rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad,
    dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};
const pointsOf = (feature) =>
  feature.paths.map((path) =>
    path.map(([longitude, latitude]) => ({ latitude, longitude })),
  );
const lengthOf = (feature) =>
  pointsOf(feature).reduce(
    (sum, line) =>
      sum +
      line
        .slice(1)
        .reduce((acc, point, i) => acc + metersBetween(line[i], point), 0),
    0,
  );
// A point on the trail itself (its first path's middle vertex), so snapping is not part of what is being tested.
const midpoint = (feature) => {
  const line = pointsOf(feature)[0];
  return line[Math.floor(line.length / 2)];
};

const plan = (from, to, extra = {}) =>
  call({
    op: "plan",
    start: from,
    destination: to,
    proposed: false,
    now: NOW,
    ...extra,
  });
const isRoute = (result) =>
  result.route && result.ok !== false && !result.error;
const inspect = (route) => call({ op: "inspect", route, now: NOW });

const started = Date.now();
// Connected parts are PREDICTED from geometry (a trail end lying within the graph's snap distance of another trail)
// and then CONFIRMED with the router itself, which is the authority: any disagreement is reported, never hidden.
const SNAP_METERS = 15;
const local = (p, origin) => ({
  x:
    (p.longitude - origin.longitude) *
    111320 *
    Math.cos((origin.latitude * Math.PI) / 180),
  y: (p.latitude - origin.latitude) * 110540,
});
const distanceToLine = (point, line) => {
  const o = point,
    p = local(point, o);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = local(line[i - 1], o),
      b = local(line[i], o);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len2 = dx * dx + dy * dy;
    const t = len2
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
      : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
  }
  return best;
};
const ends = features.map((f) =>
  pointsOf(f).flatMap((line) => [line[0], line[line.length - 1]]),
);
const lines = features.map((f) => pointsOf(f));
const parent = features.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
for (let a = 0; a < features.length; a++)
  for (let b = a + 1; b < features.length; b++) {
    if (find(a) === find(b)) continue;
    const joined =
      ends[a].some((end) =>
        lines[b].some((line) => distanceToLine(end, line) <= SNAP_METERS),
      ) ||
      ends[b].some((end) =>
        lines[a].some((line) => distanceToLine(end, line) <= SNAP_METERS),
      );
    if (joined) parent[find(a)] = find(b);
  }
const groups = new Map();
features.forEach((_, i) => {
  const root = find(i);
  groups.set(root, [...(groups.get(root) ?? []), i]);
});
const parts = [...groups.values()]
  .map((members) => ({ members }))
  .sort((a, b) => b.members.length - a.members.length);
const routes = [];
const disagreements = [];
const reachable = (fromIndex, toIndex) => {
  const result = plan(
    midpoint(features[fromIndex]),
    midpoint(features[toIndex]),
  );
  const ok = isRoute(result) && !(result.accessGaps?.length > 0);
  if (ok) routes.push(result);
  return ok;
};
{
  const anchor = parts[0].members[0];
  // Inside the largest predicted part, routes must exist to a spread of its members.
  const spread = parts[0].members.filter(
    (_, i, all) => i % Math.max(1, Math.floor(all.length / 12)) === 0,
  );
  for (const member of spread)
    if (member !== anchor && !reachable(anchor, member))
      disagreements.push({
        expected: "joined",
        features: [features[anchor].id, features[member].id],
      });
  for (const part of parts.slice(1)) {
    // A different predicted part must NOT be reachable from the largest one...
    if (reachable(anchor, part.members[0]))
      disagreements.push({
        expected: "disconnected",
        features: [features[anchor].id, features[part.members[0]].id],
      });
    // ...and its own members must be reachable from each other.
    if (
      part.members.length > 1 &&
      !reachable(part.members[0], part.members[part.members.length - 1])
    )
      disagreements.push({
        expected: "joined",
        features: [
          features[part.members[0]].id,
          features[part.members[part.members.length - 1]].id,
        ],
      });
  }
}
const km = (m) => Math.round(m / 100) / 10;
const partSummary = parts.map((part) => ({
  features: part.members.length,
  km: km(part.members.reduce((sum, i) => sum + lengthOf(features[i]), 0)),
}));
const totalKm = km(features.reduce((sum, f) => sum + lengthOf(f), 0));
const lats = features.flatMap((f) => f.paths.flat().map((p) => p[1]));
const lons = features.flatMap((f) => f.paths.flat().map((p) => p[0]));

// Every route the router just made must still be current when reopened: catches false "stale" verdicts on real geometry.
const revalidation = {
  checked: 0,
  current: 0,
  notCurrent: [],
  unverifiedConnections: { routes: 0, maxMeters: 0 },
};
for (const result of routes) {
  const reopened = inspect(result.route);
  revalidation.checked++;
  if (reopened.network?.status === "current" && reopened.canNavigate)
    revalidation.current++;
  else
    revalidation.notCurrent.push({
      status: reopened.network?.status,
      issues: reopened.network?.issues?.slice(0, 2),
    });
}

// --all: plan from EVERY reviewed trail to one anchor and reopen each route. On real geometry a correct check must
// call every route the router just made current; this is the guard against false "changed" verdicts.
if (process.argv.includes("--all")) {
  const anchor = midpoint(features[parts[0].members[0]]);
  for (const feature of features) {
    const result = plan(midpoint(feature), anchor);
    if (!isRoute(result)) continue;
    const reopened = inspect(result.route);
    revalidation.checked++;
    if (reopened.accessGaps?.length) {
      revalidation.unverifiedConnections.routes++;
      for (const gap of reopened.accessGaps)
        revalidation.unverifiedConnections.maxMeters = Math.max(
          revalidation.unverifiedConnections.maxMeters,
          Math.round(gap.distanceMeters),
        );
    }
    if (reopened.network?.status === "current" && reopened.canNavigate)
      revalidation.current++;
    else {
      revalidation.notCurrent.push({
        from: feature.id,
        status: reopened.network?.status,
        issues: reopened.network?.issues?.slice(0, 2),
        blockedBy:
          reopened.network?.status === "current"
            ? (reopened.warnings ?? []).slice(0, 1)
            : undefined,
      });
      if (process.env.TRAIL_DEBUG_STALE && reopened.network?.status === "stale")
        for (const issue of reopened.network.issues) {
          const owner = features.find((f) => f.id === issue.featureId);
          for (const edge of result.route.edges.filter(
            (e) => e.sourceFeatureId === issue.featureId,
          ))
            console.error(
              "STALE",
              feature.id,
              issue.featureId,
              "edge",
              edge.id,
              "connector",
              edge.connectorOfEdgeId,
              JSON.stringify(
                edge.routeSegments.map((s) =>
                  s.points.map((p) => [p.longitude, p.latitude]),
                ),
              ),
              "FEATURE",
              JSON.stringify(
                owner.paths.map((p) => [p[0], p.at(-1), p.length]),
              ),
            );
        }
    }
  }
}

const cases = [];
const largest = parts[0]?.members ?? [];
const pick = (list, fraction) => list[Math.floor((list.length - 1) * fraction)];
if (largest.length > 1) {
  const a = features[pick(largest, 0)],
    b = features[pick(largest, 1)],
    c = features[pick(largest, 0.5)];
  for (const [name, from, to] of [
    ["point-to-point across the largest connected part", a, b],
    ["point-to-point, shorter", a, c],
  ]) {
    const t = Date.now();
    const result = plan(midpoint(from), midpoint(to));
    cases.push({
      case: name,
      routed: isRoute(result),
      miles: isRoute(result)
        ? Math.round((result.distance / 1609.344) * 100) / 100
        : null,
      canNavigate: result.canNavigate ?? false,
      warnings: result.warnings ?? [],
      ms: Date.now() - t,
    });
  }
  for (const miles of [3, 5, 10, 25]) {
    const t = Date.now();
    const result = plan(midpoint(features[largest[0]]), undefined, { miles });
    cases.push({
      case: `${miles}-mile loop from the largest part`,
      routed: isRoute(result),
      miles: isRoute(result)
        ? Math.round((result.distance / 1609.344) * 100) / 100
        : null,
      targetMatched: result.targetMatched ?? null,
      retracedMiles:
        typeof result.retracedDistance === "number"
          ? Math.round((result.retracedDistance / 1609.344) * 100) / 100
          : null,
      canNavigate: result.canNavigate ?? false,
      error: result.error ?? null,
      ms: Date.now() - t,
    });
  }
}
if (parts.length > 1) {
  const from = features[parts[0].members[0]],
    to = features[parts[parts.length - 1].members[0]];
  const result = plan(midpoint(from), midpoint(to));
  cases.push({
    case: "disconnected pair (largest part to smallest part)",
    routed: isRoute(result),
    unverifiedConnections: result.accessGaps?.length ?? 0,
    canNavigate: result.canNavigate ?? false,
    error: result.error ?? null,
  });
}
// A lone trail that joins nothing: routes onto it from elsewhere may only exist as unverified connections.
const isolated = parts.find((part) => part.members.length === 1);
if (isolated && parts[0].members.length > 1) {
  const result = plan(
    midpoint(features[parts[0].members[0]]),
    midpoint(features[isolated.members[0]]),
  );
  cases.push({
    case: "route to a trail that joins nothing",
    routed: isRoute(result),
    unverifiedConnections: result.accessGaps?.length ?? 0,
    canNavigate: result.canNavigate ?? false,
    error: result.error ?? null,
  });
}

// Access: with no street data a start off the trails cannot be joined to them by a verified connection.
const off = {
  latitude: lats.reduce((a, b) => a + b, 0) / lats.length + 0.02,
  longitude: lons.reduce((a, b) => a + b, 0) / lons.length + 0.02,
};
{
  const result = plan(off, midpoint(features[largest[0] ?? 0]));
  cases.push({
    case: "start far from every reviewed trail (no street access data)",
    routed: isRoute(result),
    canNavigate: result.canNavigate ?? false,
    unverifiedConnections: result.accessGaps?.length ?? 0,
    error: result.error ?? null,
  });
}

// Closures: which known closures touch the reviewed trails, and what the router does about them.
const closures = init.closures ?? [];
const closureCases = [];
for (const closure of closures) {
  const targets = [
    closure.closedFrom,
    closure.closedTo,
    ...(closure.points ?? []),
  ].filter(Boolean);
  let nearest = { meters: Infinity, id: null };
  for (const feature of features)
    for (const line of pointsOf(feature))
      for (const point of line)
        for (const target of targets) {
          const meters = metersBetween(point, target);
          if (meters < nearest.meters) nearest = { meters, id: feature.id };
        }
  const onIt = features.find((f) => f.id === nearest.id);
  const anchor = midpoint(features[parts[0].members[0]]);
  const across = nearest.meters <= 25 ? plan(midpoint(onIt), anchor) : null;
  closureCases.push({
    closure: closure.title,
    nearestReviewedTrail: nearest.id,
    metersToNearestReviewedTrail: Math.round(nearest.meters),
    routeFromTheClosedTrail: across
      ? {
          routed: isRoute(across),
          canNavigate: across.canNavigate ?? false,
          unverifiedConnections: across.accessGaps?.length ?? 0,
          warnings: across.warnings ?? [],
          closuresReported: (across.closures ?? []).map((c) => c.title),
          error: across.error ?? null,
        }
      : null,
  });
}

const report = {
  dataset: {
    id: record.id,
    version: record.version,
    features: features.length,
  },
  coverage: {
    totalKm,
    bbox: {
      south: Math.min(...lats),
      north: Math.max(...lats),
      west: Math.min(...lons),
      east: Math.max(...lons),
    },
    connectedParts: parts.length,
    largestPartFeatures: parts[0]?.members.length ?? 0,
    largestPartShare: Math.round(
      ((parts[0]?.members.length ?? 0) / features.length) * 100,
    ),
    parts: partSummary.slice(0, 12),
    singletonParts: parts.filter((p) => p.members.length === 1).length,
  },
  routerAgreement: { checked: routes.length, disagreements },
  revalidation,
  cases,
  closures: { knownClosures: closures.length, cases: closureCases },
  analysisMs: Date.now() - started,
};
console.log(JSON.stringify(report, null, 2));
