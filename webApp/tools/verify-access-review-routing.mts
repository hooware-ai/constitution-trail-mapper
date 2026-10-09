// Real production AccessLoader + Kotlin router versus the full fresh road source.
// Also cold-revalidates routes made on verified v5 derived data. No native/GPS parity claim.
// npx tsx tools/verify-access-review-routing.mts <fresh.json> <v5-dist-data> <report.json>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AccessLoader, AccessSession } from "../src/accessTiles.ts";
import { repoRoot, webRoot } from "./lib/core.mjs";

const [freshFile, baselineDirectory, output] = process.argv.slice(2);
assert(
  freshFile && baselineDirectory && output,
  "Expected fresh source, v5 data directory, report",
);
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const directory = join(webRoot, "generated/county");
const record = JSON.parse(
  await readFile(join(directory, "dataset.json"), "utf8"),
);
const trails = await readFile(join(directory, record.content.file), "utf8");
assert.equal(sha(trails), record.content.sha256);
const fresh = await readFile(resolve(freshFile), "utf8");
assert.equal(sha(fresh), record.access.source.inputSha256);
const oldRecord = JSON.parse(
  await readFile(join(baselineDirectory, "dataset.json"), "utf8"),
);
assert.equal(
  oldRecord.content.sha256,
  record.content.sha256,
  "Trail content must match v5 for this narrow road comparison",
);
async function verifiedOld(part: any) {
  const bytes = await readFile(join(baselineDirectory, part.file));
  assert.equal(sha(bytes), part.sha256);
  return JSON.parse(bytes.toString("utf8"));
}
const oldBase = await verifiedOld(oldRecord.access.base);
const oldIndex = await verifiedOld(oldRecord.access.index);
assert.equal(
  oldRecord.access.index.sha256,
  "672e9d1c871121c97896e03fe1825f228a8024ebc386270eba0d8b67008536e0",
);
const oldLocal = new Map<string, any>();
for (const tile of oldIndex.tiles)
  for (const f of (await verifiedOld(tile)).layers[0].features) {
    if (oldLocal.has(f.id)) assert.deepEqual(oldLocal.get(f.id), f);
    oldLocal.set(f.id, f);
  }
const oldAccess = JSON.stringify({
  layers: [
    ...oldBase.layers,
    {
      id: "osm-service",
      features: [...oldLocal.values()].sort((a, b) => a.ord - b.ord),
    },
  ],
});
let serial = 0;
const NOW = Date.parse("2026-10-04T12:00:00Z");
async function instance(access: string | null) {
  const module = await import(
    `${pathToFileURL(join(repoRoot, "webBridge/build/dist/js/productionLibrary/TrailMapper-webBridge.mjs")).href}?review=${++serial}`
  );
  const dispatch = (request: any) =>
    JSON.parse(module.dispatch(JSON.stringify(request)));
  let loader: AccessLoader | null = null;
  if (access === null) {
    loader = new AccessLoader(record.access, {
      async fetchBytes(file) {
        const bytes = await readFile(join(directory, file));
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
      },
      async sha256Hex(bytes) {
        return sha(new Uint8Array(bytes));
      },
      dispatch,
    });
    access = await loader.baseText();
  }
  const init = dispatch({
    op: "initialize",
    trails,
    access,
    trustSerializedRoutes: false,
    now: NOW,
  });
  assert.notEqual(init.ok, false, init.error);
  const session = loader ? new AccessSession<any>(loader, dispatch) : null;
  return {
    run: async (request: any) =>
      session ? session.run(request) : dispatch(request),
    loader,
  };
}
const full = await instance(fresh),
  production = await instance(null),
  old = await instance(oldAccess);
const features = JSON.parse(trails).layers.flatMap(
  (layer: any) => layer.features,
);
const at = (f: any, ratio: number) => {
  const points = f.paths.flat();
  const [longitude, latitude] = points[Math.floor((points.length - 1) * ratio)];
  return { latitude, longitude };
};
const ic = features
  .filter((f: any) => (f.name ?? "").includes("Illinois Central"))
  .sort((a: any, b: any) => b.paths.flat().length - a.paths.flat().length)[0];
const osm = features
  .filter((f: any) => String(f.id).startsWith("verified-osm:"))
  .sort((a: any, b: any) => b.paths.flat().length - a.paths.flat().length)[0];
assert(ic && osm, "Need both county and reviewed OSM trail subjects");
const snap = async (point: any, now = NOW) =>
  (await full.run({ op: "mapPoint", point, proposed: false, now })).point ??
  point;
const rows: any[] = [];
async function compare(name: string, request: any, requireRoute = false) {
  const expected = await full.run(request),
    actual = await production.run(request);
  assert.deepEqual(
    actual,
    expected,
    `${name}: production loader differs from whole fresh extract`,
  );
  if (requireRoute)
    assert(actual.route, `${name}: missing route makes evidence vacuous`);
  rows.push({
    name,
    equal: true,
    routed: !!actual.route,
    canNavigate: !!actual.canNavigate,
    gaps: actual.accessGaps?.length ?? 0,
    network: actual.network?.status,
    closures: actual.closures?.map((c: any) => c.id) ?? [],
  });
  console.log(JSON.stringify(rows.at(-1)));
  return actual;
}
const requests = [
  {
    name: "County mapped endpoints",
    request: {
      op: "plan",
      start: await snap(at(ic, 0.15)),
      destination: await snap(at(ic, 0.85)),
      proposed: false,
      now: NOW,
    },
  },
  {
    name: "Reviewed OSM mapped endpoints",
    request: {
      op: "plan",
      start: await snap(at(osm, 0.1)),
      destination: await snap(at(osm, 0.9)),
      proposed: false,
      now: NOW,
    },
  },
  {
    name: "Three mile real-data loop",
    request: {
      op: "plan",
      start: await snap(at(ic, 0.5)),
      miles: 3,
      proposed: false,
      now: NOW,
    },
  },
];
for (const { name, request } of requests) {
  const actual = await compare(name, request, true);
  if (request.op === "plan" && "miles" in request) {
    assert(
      actual.accessGaps?.length && !actual.canNavigate,
      "This reviewed real loop retains an estimated gap, which must block ordinary navigation",
    );
  }
  const cold = await instance(null);
  const inspect = { op: "inspect", route: actual.route, now: NOW };
  assert.deepEqual(
    await cold.run(inspect),
    await full.run(inspect),
    `${name}: cold restored ride differs`,
  );
  const prior = await old.run(request);
  assert(prior.route, `${name}: v5 reference must produce a route`);
  const oldCold = await instance(null);
  const revalidated = await oldCold.run({
    op: "inspect",
    route: prior.route,
    now: NOW,
  });
  assert.equal(
    revalidated.network?.status,
    "current",
    `${name}: unchanged v5 route revalidation`,
  );
  rows.push({
    name: name + " cold restore and v5 saved route",
    equal: true,
    network: revalidated.network.status,
  });
}
const start = await snap({
  latitude: 40.5096012799,
  longitude: -88.9843690241,
});
const destination = await snap({
  latitude: 40.516684074,
  longitude: -88.9849653323,
});
const activation = Date.parse("2026-10-05T11:00:00Z"),
  afterEstimate = Date.parse("2026-10-19T22:00:00Z") + 1;
const willow = await compare(
  "Willow before closure",
  { op: "plan", start, destination, proposed: false, now: activation - 1 },
  true,
);
for (const now of [activation, afterEstimate]) {
  const checked = await compare(
    `Willow inspect ${now}`,
    { op: "inspect", route: willow.route, now },
    true,
  );
  assert(
    checked.closures?.length,
    "Closure must remain represented at activation and beyond estimate",
  );
  assert.equal(
    checked.canNavigate,
    false,
    "Active closure must block navigation",
  );
  const snapshot = await compare(`Willow start/resume ${now}`, {
    op: "snapshot",
    route: willow.route,
    point: start,
    accuracy: 5,
    timestamp: now,
    progress: 0,
    resume: true,
    now,
  });
  assert.equal(snapshot.ok, false, "Active closure must refuse a resumed ride");
}
await compare("Willow recalculate during closure", {
  op: "recalculate",
  route: willow.route,
  now: activation,
});
const off = { latitude: 40.8, longitude: -89.3 };
const outside = await compare(
  "Endpoint outside road coverage refuses navigation",
  {
    op: "plan",
    start: off,
    destination: await snap(at(ic, 0.5)),
    proposed: false,
    now: NOW,
  },
);
assert.equal(
  outside.route,
  null,
  "Outside-coverage endpoint must have no route",
);
assert.equal(outside.canNavigate, false);
const report = {
  schemaVersion: 1,
  sourceCommit: record.access.source,
  dataset: record.version,
  rows,
  productionTilesLoaded: production.loader?.loadedCells.length,
  limits:
    "Real shared router and production tile loader in cloud; not native raw/tag equivalence, physical GPS or public approval. Conditional access policy retained. Old v5 comparisons use verified derived roads only.",
};
await writeFile(resolve(output), JSON.stringify(report, null, 2) + "\n");
console.log(`Real-data checks passed: ${rows.length} cases`);
