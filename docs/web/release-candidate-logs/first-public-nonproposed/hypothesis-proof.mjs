// UNAPPROVED engineering hypothesis proof (local, read-only, temp output): the packaged 254 Existing + 4 reviewed OSM + 12737
// access roads, with NO Proposed package flag, compared with what native loads, through the real shared Kotlin core.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RC = "C:/Users/Jesse Donahoo/Documents/ctm-web-release-candidate";
const NATIVE = "C:/Users/Jesse Donahoo/Documents/Constitution Trail Mapper/data/generated";
const PKG = process.argv[2];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const readText = (p) => readFileSync(p, "utf8");
const out = { checks: [] };
const note = (name, ok, detail) => {
  out.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
};

// ---- inputs -----------------------------------------------------------------------------------------------------------
const rawCounty = readText(join(NATIVE, "mcgis-trails.normalized.json"));
const rawOsm = readText(join(NATIVE, "verified-trail-additions.normalized.json"));
const rawAccess = readText(join(NATIVE, "mclean-access-roads.normalized.json"));
const county = JSON.parse(rawCounty);
const osm = JSON.parse(rawOsm);
const nativeAccess = JSON.parse(rawAccess);
const record = JSON.parse(readText(join(PKG, "dataset.json")));
const pkgNetwork = JSON.parse(readText(join(PKG, record.content.file)));
const pkgBase = JSON.parse(readText(join(PKG, record.access.base.file)));
const pkgIndex = JSON.parse(readText(join(PKG, record.access.index.file)));
out.hashes = {
  nativeCounty: sha(rawCounty),
  nativeOsm: sha(rawOsm),
  nativeAccess: sha(rawAccess),
  packagedNetwork: record.content.sha256,
  packagedAccessBase: record.access.base.sha256,
  packagedAccessIndex: record.access.index.sha256,
  combinedAccess: record.access.combinedSha256,
  version: record.version,
};
console.log(JSON.stringify(out.hashes, null, 1));
note("native assets match the recorded hashes",
  out.hashes.nativeCounty === "310f1d50326a207ea22eb05cda78759bc62d1c4df55bd0515f6608f974b8b3a8" &&
  out.hashes.nativeOsm === "2f97e23b5d6dae09be245772c9cfebfab13c44fe71df6a60a6d93a63797ae317" &&
  out.hashes.nativeAccess === "23a9719dd45297352cef641014697ca0b263184af9fdace48573b0d6ba264d07");

// ---- A. static equivalence --------------------------------------------------------------------------------------------
const nativeActive = [
  ...county.layers.flatMap((l) => l.features).filter((f) => f.status !== "Proposed"),
  ...osm.layers.flatMap((l) => l.features),
];
const packaged = pkgNetwork.layers.flatMap((l) => l.features);
note("counts: native default-active 258 = packaged 258", nativeActive.length === 258 && packaged.length === 258, `${nativeActive.length} vs ${packaged.length}`);
const idOf = (f) => String(f.id);
const fieldDiffs = (a, b) => {
  const fields = [];
  if (JSON.stringify(a.paths) !== JSON.stringify(b.paths)) fields.push("paths");
  if (a.status !== b.status) fields.push("status");
  if (JSON.stringify(a.routeRoles) !== JSON.stringify(b.routeRoles)) fields.push("routeRoles");
  if ((a.facilityType ?? null) !== (b.facilityType ?? null)) fields.push("facilityType");
  if ((a.comfort ?? a.comfortLevel ?? null) !== (b.comfort ?? b.comfortLevel ?? null)) fields.push("comfort");
  if ((a.name ?? null) !== (b.name ?? null)) fields.push("name");
  return fields;
};
const packagedById = new Map(packaged.map((f) => [idOf(f), f]));
const perField = {};
let missingIds = 0;
for (const a of nativeActive) {
  const b = packagedById.get(idOf(a));
  if (!b) { missingIds++; continue; }
  for (const f of fieldDiffs(a, b)) perField[f] = (perField[f] ?? 0) + 1;
}
const geometryEverywhere = !perField.paths && !perField.status && !perField.routeRoles && !perField.facilityType && !perField.comfort;
note("per-id content: every packaged feature has native's geometry, status, route role, facility type and comfort", missingIds === 0 && geometryEverywhere,
  `missing ids ${missingIds}; differing fields by count ${JSON.stringify(perField)}`);
out.nameDifferences = perField.name ?? 0;
let positionDiffs = 0;
for (let i = 0; i < nativeActive.length; i++) if (idOf(nativeActive[i]) !== idOf(packaged[i])) positionDiffs++;
const firstIds = (arr) => arr.slice(0, 4).map(idOf).join(",");
const layersOrder = (net) => net.layers.map((l) => `${l.id}:${l.features.length}`).join(" ");
note("ORDER: packaged feature order equals native default-active order", positionDiffs === 0,
  `${positionDiffs} of 258 positions differ; native starts ${firstIds(nativeActive)}; packaged starts ${firstIds(packaged)}; native layers ${layersOrder({ layers: [...county.layers, ...osm.layers] })}; packaged layers ${layersOrder(pkgNetwork)}`);
out.orderDifferingPositions = positionDiffs;
note("no Proposed feature is packaged", !packaged.some((f) => f.status === "Proposed"));

const nativeBase = nativeAccess.layers.find((l) => String(l.id) === "8").features;
const nativeLocal = nativeAccess.layers.find((l) => l.id === "osm-service").features;
const baseMismatch = [];
for (let i = 0; i < Math.max(nativeBase.length, pkgBase.layers[0].features.length); i++) {
  const a = nativeBase[i], b = pkgBase.layers[0].features[i];
  if (!a || !b || a.id !== b.id || JSON.stringify(a.paths) !== JSON.stringify(b.paths) || a.mtfcc !== b.mtfcc || (a.name ?? null) !== (b.name ?? null))
    baseMismatch.push(i);
}
note("base access roads (TIGER 3424) agree in order, ids, geometry, class and name", baseMismatch.length === 0, `${nativeBase.length} vs ${pkgBase.layers[0].features.length}; mismatches ${baseMismatch.length}`);
const tileFiles = readdirSync(PKG).filter((f) => f.startsWith("access-tile."));
const tileOf = new Map();
for (const f of tileFiles) tileOf.set(f.split(".")[1], JSON.parse(readText(join(PKG, f))));
// The index names each tile; tile order here is index order (the browser fetches them on demand).
const tileKeys = pkgIndex.tiles.map((t, i) => i);
const union = [];
const seen = new Set();
let assignments = 0;
for (const key of tileKeys) {
  const entry = pkgIndex.tiles[key];
  const tile = JSON.parse(readText(join(PKG, entry.file)));
  for (const layer of tile.layers) for (const f of layer.features) { assignments++; if (!seen.has(f.id)) { seen.add(f.id); union.push(f); } }
}
const nativeLocalById = new Map(nativeLocal.map((f) => [f.id, f]));
const missing = nativeLocal.filter((f) => !seen.has(f.id)).length;
const extra = union.filter((f) => !nativeLocalById.has(f.id)).length;
const geomDiff = union.filter((f) => nativeLocalById.has(f.id) && JSON.stringify(nativeLocalById.get(f.id).paths) !== JSON.stringify(f.paths)).length;
note("local OSM service roads: 9313 in tiles, same ids and geometry as native", missing === 0 && extra === 0 && geomDiff === 0 && union.length === 9313,
  `union ${union.length} (assignments ${assignments}), missing ${missing}, extra ${extra}, geometry differences ${geomDiff}`);
const sameOrder = union.every((f, i) => f.id === nativeLocal[i]?.id);
out.localOrderSameAsNative = sameOrder;
console.log(`INFO  local-road ORDER: tile order ${sameOrder ? "equals" : "differs from"} native order (the browser loads tiles on demand; the core reads them in the order added)`);
out.access = { base: nativeBase.length, localUnion: union.length, total: nativeBase.length + union.length };

// ---- B. behavior through the real core ------------------------------------------------------------------------------
const core = await import(pathToFileURL(join(RC, "webBridge/build/dist/js/productionLibrary/TrailMapper-webBridge.mjs")).href);
const call = (r) => JSON.parse(core.dispatch(JSON.stringify(r)));
const NOW = Date.parse("2026-10-01T15:00:00Z");
const configs = {
  native: { trails: JSON.stringify({ ...county, layers: [...county.layers, ...osm.layers] }), access: rawAccess },
  packaged: {
    trails: JSON.stringify(pkgNetwork),
    access: JSON.stringify({ layers: [{ id: 8, features: pkgBase.layers[0].features }, { id: "osm-service", features: union }] }),
  },
  // Same packaged trails, access in NATIVE's own order: separates a data difference from an ordering effect.
  packagedNativeOrderAccess: { trails: JSON.stringify(pkgNetwork), access: rawAccess },
};
const init = (name, now = NOW) => {
  const r = call({ op: "initialize", trails: configs[name].trails, access: configs[name].access, trustSerializedRoutes: false, now });
  if (r.ok === false) throw new Error(`${name}: ${r.error}`);
  return r;
};
const search = readText(join(RC, "webApp/src/search.ts"));
const places = [...search.matchAll(/label:\s*"([^"]+)",[\s\S]*?latitude:\s*(-?[\d.]+),\s*longitude:\s*(-?[\d.]+)/g)].map(([, label, latitude, longitude]) => ({ label, latitude: Number(latitude), longitude: Number(longitude) }));
const mapPoint = (p, now = NOW) => call({ op: "mapPoint", point: p, proposed: false, now }).point ?? p;
const geom = (r) => JSON.stringify((r.segments ?? []).map((x) => [x.type, x.isRouted, x.points]));
const sig = (r) => !r || r.ok === false || !r.route ? "none" : sha(geom(r)) + "|" + Math.round(r.distance) + "|" + (r.accessGaps ?? []).length + "|" + (r.canNavigate ? "go" : "no") + "|" + (r.closures ?? []).length;
const summarize = (r) => !r || r.ok === false || !r.route ? "none" : `${(r.distance / 1609.344).toFixed(2)}mi gaps=${(r.accessGaps ?? []).length} ${r.canNavigate ? "START" : "no-start"}`;

const results = {};
for (const name of Object.keys(configs)) {
  const info = init(name);
  const rows = {};
  // point-to-point over the catalog (as in the parity probe), then loops, then mapped-start controls
  for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++)
    rows[`p2p ${places[i].label} -> ${places[j].label}`] = call({ op: "plan", start: places[i], destination: places[j], proposed: false, now: NOW });
  for (const p of places) for (const miles of [3, 8])
    rows[`loop ${miles}mi ${p.label}`] = call({ op: "plan", start: p, miles, proposed: false, now: NOW });
  // targeted: 2-mile loop from the midpoint of each reviewed OSM way
  for (const f of osm.layers.flatMap((l) => l.features)) {
    const path = f.paths.flat();
    const [longitude, latitude] = path[Math.floor(path.length / 2)];
    rows[`osm ${f.name ?? f.id}`] = call({ op: "plan", start: { latitude, longitude }, miles: 2, proposed: false, now: NOW });
  }
  // mapped starts: points snapped by the app's own map picker, on actual trail vertices across the network
  const feats = nativeActive.filter((f) => f.status === "Existing");
  const pick = (k) => { const path = feats[(k * 37) % feats.length].paths[0]; const [longitude, latitude] = path[Math.floor(path.length / 2)]; return { latitude, longitude }; };
  for (let k = 0; k < 24; k++) {
    const a = mapPoint(pick(k)), b = mapPoint(pick(k + 11));
    rows[`mapped p2p #${k}`] = call({ op: "plan", start: a, destination: b, proposed: false, now: NOW });
    rows[`mapped loop #${k}`] = call({ op: "plan", start: a, miles: 3, proposed: false, now: NOW });
  }
  results[name] = { rows, info: { features: info.featureCount, access: info.accessFeatureCount } };
}
out.coreInit = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.info]));
console.log("core init", JSON.stringify(out.coreInit));
const compare = (aName, bName) => {
  const diffs = [];
  let startable = 0, found = 0;
  for (const key of Object.keys(results[aName].rows)) {
    const a = results[aName].rows[key], b = results[bName].rows[key];
    if (a.route) found++;
    if (a.canNavigate && b.canNavigate) startable++;
    if (sig(a) !== sig(b)) diffs.push(`${key}: ${summarize(a)} vs ${summarize(b)}`);
  }
  return { diffs, found, startable, total: Object.keys(results[aName].rows).length };
};
for (const other of ["packaged", "packagedNativeOrderAccess"]) {
  const c = compare("native", other);
  note(`default requests: native vs ${other} identical (route geometry, distance, gaps, Start, closures)`, c.diffs.length === 0,
    `${c.total} requests, ${c.found} routed, ${c.startable} eligible Start on both; ${c.diffs.length} differences${c.diffs.length ? " e.g. " + c.diffs.slice(0, 4).join(" | ") : ""}`);
  out[`diffs_${other}`] = c.diffs;
}
const eligible = Object.values(results.packaged.rows).filter((r) => r.canNavigate).length;
note("positive Start controls exist in the packaged configuration", eligible >= 3, `${eligible} eligible Start routes`);

// ---- cold inspections: routes planned on native, inspected on the packaged network ------------------------------------------
init("native");
const planned = [];
for (const key of Object.keys(results.native.rows)) {
  const r = results.native.rows[key];
  if (r.route && planned.length < 60 && r.canNavigate) planned.push([key, r.route, r]);
}
init("packaged");
let current = 0, canGo = 0, notCurrent = [];
for (const [key, route, r] of planned) {
  const i = call({ op: "inspect", route, now: NOW });
  if (i.network?.status === "current") current++; else notCurrent.push(`${key}:${i.network?.status}`);
  if (i.canNavigate === r.canNavigate) canGo++;
}
note("cold inspection: native-planned routes are current and keep their Start verdict on the packaged network", current === planned.length && canGo === planned.length,
  `${planned.length} routes, current ${current}, same verdict ${canGo}${notCurrent.length ? ", e.g. " + notCurrent.slice(0, 3).join(", ") : ""}`);

// ---- closure cases: the actual Willow leg ------------------------------------------------------------------------------------
const V97 = { latitude: 40.5096012799, longitude: -88.9843690241 }, V98 = { latitude: 40.516684074, longitude: -88.9849653323 };
const W = { start: Date.parse("2026-10-05T11:00:00Z"), end: Date.parse("2026-10-19T22:00:00Z") };
const willow = {};
for (const name of ["native", "packaged"]) {
  init(name, W.start - 86400000);
  const a = mapPoint(V97, W.start - 1000), b = mapPoint(V98, W.start - 1000);
  const before = call({ op: "plan", start: a, destination: b, proposed: false, now: W.start - 1 });
  const row = { before: sig(before), startBefore: before.canNavigate };
  if (before.route) {
    for (const [label, now] of [["activation", W.start], ["after estimate", W.end + 1]]) {
      const i = call({ op: "inspect", route: before.route, now });
      row[label] = `${i.canNavigate ? "go" : "refused"}:${(i.closures ?? []).map((c) => c.id).join(",")}`;
    }
    const re = call({ op: "recalculate", route: before.route, now: W.start });
    row.recalculate = re.route ? `route:${re.canNavigate ? "go" : "no"}` : "refused";
  }
  const mid = call({ op: "plan", start: mapPoint({ latitude: V97.latitude + (V98.latitude - V97.latitude) * 0.6, longitude: V97.longitude + (V98.longitude - V97.longitude) * 0.6 }, W.start - 1000), destination: mapPoint({ latitude: V97.latitude + (V98.latitude - V97.latitude) * 0.6 + 0.00005, longitude: V97.longitude + (V98.longitude - V97.longitude) * 0.6 }, W.start - 1000), proposed: false, now: W.start - 1 });
  if (mid.route) {
    row.shortInside = call({ op: "inspect", route: mid.route, now: W.start }).canNavigate ? "go" : "refused";
    row.shortInsideRecalc = call({ op: "recalculate", route: mid.route, now: W.start }).route ? "route" : "refused";
  }
  willow[name] = row;
}
out.willow = willow;
console.log("willow", JSON.stringify(willow));
note("closure: the actual Willow control is identical native vs packaged and refused from activation", JSON.stringify(willow.native) === JSON.stringify(willow.packaged) && /refused/.test(willow.packaged.activation ?? "") && /refused/.test(willow.packaged["after estimate"] ?? "") && willow.packaged.shortInside === "refused",
  JSON.stringify(willow.packaged));

console.log(`\n${out.checks.filter((c) => c.ok).length}/${out.checks.length} checks passed`);
import { writeFileSync } from "node:fs";
writeFileSync(join(process.env.TEMP ?? "C:/Temp", "hypothesis-proof-result.json"), JSON.stringify({ ...out, diffs_packaged: out.diffs_packaged?.slice(0, 50), diffs_packagedNativeOrderAccess: out.diffs_packagedNativeOrderAccess?.slice(0, 50) }, null, 1));
