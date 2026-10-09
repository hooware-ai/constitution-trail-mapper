// Smallest nonvacuous behavior set for ONE configuration (run one process per configuration; each step logs at once).
// 2026-10-04 copy for the native-package-order fix: separate output names (hp2-*), accurate warm/cold labels, and an explicit
// check that every planned route exists before any verdict is read. The earlier hp-config.mts and its logs are untouched.
//   node/tsx hp-config.mts <native|packaged-monolith|packaged-production> <packageDir>
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RC = "C:/Users/Jesse Donahoo/Documents/ctm-web-release-candidate";
const NATIVE = "C:/Users/Jesse Donahoo/Documents/Constitution Trail Mapper/data/generated";
const [, , CONFIG, PKG] = process.argv;
const PREFIX = process.env.HP_PREFIX ?? "hp2";
const LOG = `C:/Temp/${PREFIX}-${CONFIG}.log`;
const OUT = `C:/Temp/${PREFIX}-${CONFIG}.json`;
writeFileSync(LOG, "");
const log = (line: string) => {
  appendFileSync(LOG, line + "\n");
  console.log(line);
};
const t0 = Date.now();
const lap = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const text = (p: string) => readFileSync(p, "utf8");

const { AccessLoader, accessPointsOf, needsAccess } = await import(pathToFileURL(join(RC, "webApp/src/accessTiles.ts")).href);
const core: any = await import(pathToFileURL(join(RC, "webBridge/build/dist/js/productionLibrary/TrailMapper-webBridge.mjs")).href);
const dispatchRaw = (r: unknown) => JSON.parse(core.dispatch(JSON.stringify(r)));

const county = JSON.parse(text(join(NATIVE, "mcgis-trails.normalized.json")));
const osm = JSON.parse(text(join(NATIVE, "verified-trail-additions.normalized.json")));
const rawAccess = text(join(NATIVE, "mclean-access-roads.normalized.json"));
const record = PKG ? JSON.parse(text(join(PKG, "dataset.json"))) : null;

let trails: string, access: string | null = null, loader: any = null;
if (CONFIG === "native") {
  trails = JSON.stringify({ ...county, layers: [...county.layers, ...osm.layers] });
  access = rawAccess;
} else if (CONFIG === "native-no-proposed") {
  // Control: native's own order and layers with ONLY the six Proposed features removed.
  trails = JSON.stringify({
    ...county,
    layers: [...county.layers.map((l: any) => ({ ...l, features: l.features.filter((f: any) => f.status !== "Proposed") })), ...osm.layers],
  });
  access = rawAccess;
} else if (CONFIG === "packaged-native-order") {
  // Control: the packaged features and layer structure, reordered into native's default-active order, with native's access.
  const packagedNet = JSON.parse(text(join(PKG, record.content.file)));
  const byId = new Map<string, any>(packagedNet.layers.flatMap((l: any) => l.features).map((f: any) => [String(f.id), f]));
  const nativeOrder = [...county.layers.flatMap((l: any) => l.features).filter((f: any) => f.status !== "Proposed"), ...osm.layers.flatMap((l: any) => l.features)].map((f: any) => String(f.id));
  const county254 = nativeOrder.slice(0, 254).map((id) => byId.get(id));
  const osm4 = nativeOrder.slice(254).map((id) => byId.get(id));
  trails = JSON.stringify({ ...packagedNet, layers: [{ ...packagedNet.layers[0], features: county254 }, { ...packagedNet.layers[1], features: osm4 }] });
  access = rawAccess;
} else {
  trails = text(join(PKG, record.content.file));
  const baseText = text(join(PKG, record.access.base.file));
  if (CONFIG === "packaged-monolith") {
    // A clearly labelled control: base roads, then every tile feature in its recorded extract order (`ord`), once each.
    const base = JSON.parse(baseText);
    const index = JSON.parse(text(join(PKG, record.access.index.file)));
    const local = new Map<string, any>();
    for (const tile of index.tiles)
      for (const layer of JSON.parse(text(join(PKG, tile.file))).layers) for (const f of layer.features) local.set(f.id, f);
    const ordered = [...local.values()].sort((a, b) => a.ord - b.ord);
    access = JSON.stringify({ layers: [{ id: 8, features: base.layers[0].features }, { id: "osm-service", features: ordered }] });
  } else {
    // The production path: the real AccessLoader, base roads at initialize, tiles around the trip's endpoints before each op.
    const { readFile } = await import("node:fs/promises");
    loader = new AccessLoader(
      { ...record.access },
      {
        fetchBytes: async (file: string) => {
          const b = await readFile(join(PKG, file));
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        },
        sha256Hex: async (bytes: ArrayBuffer) => sha(Buffer.from(bytes)),
        dispatch: dispatchRaw,
      },
    );
    access = await loader.baseText();
  }
}
const NOW = Date.parse("2026-10-01T15:00:00Z");
const call = async (request: any) => {
  if (loader && needsAccess(request)) await loader.ensure(accessPointsOf(request));
  return dispatchRaw(request);
};
const init = async (now: number) => {
  const r = dispatchRaw({ op: "initialize", trails, ...(access ? { access } : {}), trustSerializedRoutes: false, now });
  if (r.ok === false) throw new Error(`initialize: ${r.error}`);
  if (loader) {
    // initialize replaces the core's state: a production session starts with no tiles loaded.
    loader.loaded?.clear?.();
  }
  return r;
};
const info = await init(NOW);
log(`[${lap()}] ${CONFIG}: initialized features=${info.featureCount} access=${info.accessFeatureCount ?? 0}`);

const geom = (r: any) => JSON.stringify((r.segments ?? []).map((x: any) => [x.type, x.isRouted, x.points]));
const facts = (r: any) =>
  !r || r.ok === false || !r.route
    ? { found: false, error: r?.error }
    : { found: true, geometry: sha(geom(r)), meters: Math.round(r.distance), gaps: (r.accessGaps ?? []).length, start: !!r.canNavigate, closures: (r.closures ?? []).map((c: any) => c.id), network: r.network?.status };
const results: any = { config: CONFIG, init: { features: info.featureCount, access: info.accessFeatureCount ?? 0 }, steps: {} };
const step = async (name: string, fn: () => Promise<any>) => {
  const s = Date.now();
  try {
    const value = await fn();
    results.steps[name] = value;
    log(`[${lap()}] ${name}: ${JSON.stringify(value).slice(0, 400)} (${((Date.now() - s) / 1000).toFixed(1)}s)`);
  } catch (e: any) {
    results.steps[name] = { error: String(e?.message ?? e) };
    log(`[${lap()}] ${name}: ERROR ${e?.message ?? e}`);
  }
};

const all = county.layers.flatMap((l: any) => l.features).filter((f: any) => f.status === "Existing");
const named = (n: string) => all.filter((f: any) => (f.name ?? "").includes(n)).sort((a: any, b: any) => b.paths.flat().length - a.paths.flat().length)[0];
const at = (f: any, share: number) => { const p = f.paths.flat(); const [longitude, latitude] = p[Math.floor((p.length - 1) * share)]; return { latitude, longitude }; };
const snap = async (p: any, now = NOW) => (await call({ op: "mapPoint", point: p, proposed: false, now })).point ?? p;
const ic = named("Illinois Central");
const osmWay = osm.layers.flatMap((l: any) => l.features).sort((a: any, b: any) => b.paths.flat().length - a.paths.flat().length)[0];
log(`subjects: Illinois Central=${ic.id} (${ic.paths.flat().length} vertices), reviewed OSM way=${osmWay.id ?? osmWay.wayId} ${osmWay.name ?? ""} (${osmWay.paths.flat().length} vertices)`);
results.subjects = { illinoisCentral: ic.id, osm: osmWay.id ?? osmWay.wayId };

const planned: any = {};
await step("IllinoisCentral mapped p2p", async () => {
  const r = await call({ op: "plan", start: await snap(at(ic, 0.15)), destination: await snap(at(ic, 0.85)), proposed: false, now: NOW });
  planned.ic = r; return facts(r);
});
await step("reviewed OSM mapped p2p", async () => {
  const r = await call({ op: "plan", start: await snap(at(osmWay, 0.1)), destination: await snap(at(osmWay, 0.9)), proposed: false, now: NOW });
  planned.osm = r; return facts(r);
});
await step("mapped-start 3 mi loop (Illinois Central)", async () => {
  const r = await call({ op: "plan", start: await snap(at(ic, 0.5)), miles: 3, proposed: false, now: NOW });
  planned.loop = r; return facts(r);
});
await step("WARM own-configuration inspect of those three (same loaded state, no reinitialize)", async () => {
  const out: any = {};
  for (const k of ["ic", "osm", "loop"]) if (planned[k]?.route) { const i = await call({ op: "inspect", route: planned[k].route, now: NOW }); out[k] = { status: i.network?.status, start: !!i.canNavigate, geometry: sha(geom(i)) === sha(geom(planned[k])) }; }
  return out;
});
// Willow (actual leg 97 -> 98): before, activation, after the estimate; Start and recalculation
const V97 = { latitude: 40.5096012799, longitude: -88.9843690241 }, V98 = { latitude: 40.516684074, longitude: -88.9849653323 };
const W = { start: Date.parse("2026-10-05T11:00:00Z"), end: Date.parse("2026-10-19T22:00:00Z") };
await step("Willow actual leg: before / activation / after, Start and recalculate", async () => {
  const a = await snap(V97, W.start - 1000), b = await snap(V98, W.start - 1000);
  const before = await call({ op: "plan", start: a, destination: b, proposed: false, now: W.start - 1 });
  const out: any = { before: facts(before) };
  if (before.route) {
    for (const [k, now] of [["activation", W.start], ["afterEstimate", W.end + 1]] as const) {
      const i = await call({ op: "inspect", route: before.route, now });
      const s = await call({ op: "snapshot", route: before.route, point: a, accuracy: 5, timestamp: now, progress: 0, resume: true, now });
      out[k] = { start: !!i.canNavigate, snapshotOk: !!s.ok, closures: (i.closures ?? []).map((c: any) => c.id) };
    }
    const re = await call({ op: "recalculate", route: before.route, now: W.start });
    out.recalculate = re.route ? { route: true, start: !!re.canNavigate, closures: (re.closures ?? []).map((c: any) => c.id) } : { route: false };
  }
  const p = (t: number) => ({ latitude: V97.latitude + (V98.latitude - V97.latitude) * t, longitude: V97.longitude + (V98.longitude - V97.longitude) * t });
  const m1 = await snap(p(0.6), W.start - 1000), m2 = await snap(p(0.6 + 5 / 790.1), W.start - 1000);
  const mid = await call({ op: "plan", start: m1, destination: m2, proposed: false, now: W.start - 1 });
  if (mid.route) {
    const i = await call({ op: "inspect", route: mid.route, now: W.start });
    const re = await call({ op: "recalculate", route: mid.route, now: W.start });
    out.interior5m = { eligibleBefore: !!mid.canNavigate, gapsBefore: (mid.accessGaps ?? []).length, startAtActivation: !!i.canNavigate, recalculateRoute: !!re.route };
  } else out.interior5m = { found: false };
  return out;
});
// Cold inspection of the NATIVE configuration's routes on this configuration
const nativeFile = `C:/Temp/${PREFIX}-native.json`;
if (CONFIG !== "native" && existsSync(nativeFile)) {
  await step("COLD inspect of routes planned on NATIVE, after this configuration is re-initialized (nothing loaded)", async () => {
    const nativeRoutes = JSON.parse(text(`C:/Temp/${PREFIX}-native-routes.json`));
    await init(NOW);
    const out: any = {};
    for (const [k, route] of Object.entries(nativeRoutes) as any) { const i = await call({ op: "inspect", route, now: NOW }); out[k] = { status: i.network?.status, start: !!i.canNavigate }; }
    return out;
  });
}
for (const key of ["ic", "osm", "loop"])
  if (!planned[key]?.route) {
    log(`ROUTE MISSING: ${key}; verdicts for ${CONFIG} are not valid`);
    process.exitCode = 3;
  }
if (CONFIG === "native") writeFileSync(`C:/Temp/${PREFIX}-native-routes.json`, JSON.stringify(Object.fromEntries(Object.entries(planned).filter(([, r]: any) => r?.route).map(([k, r]: any) => [k, r.route]))));
writeFileSync(OUT, JSON.stringify(results, null, 1));
log(`[${lap()}] done`);
