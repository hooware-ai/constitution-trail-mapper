// Real-data check of the PRIVATE estimated-connections TEST MODE through the real core and the production AccessLoader.
//   ASSUME=0|1 npx tsx real-pairs.mts <packageDir>     (run once per mode; output C:/Temp/etm-<mode>.json)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RC = "C:/Users/Jesse Donahoo/Documents/ctm-web-release-candidate";
const PKG = process.argv[2];
const ASSUME = process.env.ASSUME === "1";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const { AccessLoader, accessPointsOf, needsAccess } = await import(pathToFileURL(join(RC, "webApp/src/accessTiles.ts")).href);
const { places } = await import(pathToFileURL(join(RC, "webApp/src/search.ts")).href);
const core: any = await import(pathToFileURL(join(RC, "webBridge/build/dist/js/productionLibrary/TrailMapper-webBridge.mjs")).href);
const raw = (r: unknown) => JSON.parse(core.dispatch(JSON.stringify(r)));
const record = JSON.parse(readFileSync(join(PKG, "dataset.json"), "utf8"));
const trails = readFileSync(join(PKG, record.content.file), "utf8");
const loader = new AccessLoader({ ...record.access }, {
  fetchBytes: async (f: string) => { const b = await readFile(join(PKG, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
  sha256Hex: async (bytes: ArrayBuffer) => sha(Buffer.from(bytes)),
  dispatch: raw,
});
const NOW = Date.parse("2026-10-01T15:00:00Z");
const init = (now: number) => {
  const r = raw({ op: "initialize", trails, access: undefined, trustSerializedRoutes: false, assumeEstimatedConnections: ASSUME, now });
  if (r.ok === false) throw new Error(r.error);
  loader.loaded?.clear?.();
};
// initialize with the base roads, as the production worker does
const baseText = await loader.baseText();
const init2 = (now: number) => {
  const r = raw({ op: "initialize", trails, access: baseText, trustSerializedRoutes: false, assumeEstimatedConnections: ASSUME, now });
  if (r.ok === false) throw new Error(r.error);
  loader.loaded?.clear?.();
};
init2(NOW);
const call = async (request: any) => { if (needsAccess(request)) await loader.ensure(accessPointsOf(request)); return raw(request); };
const facts = (r: any) => !r?.route ? { found: false, error: r?.error ?? null } : { found: true, meters: Math.round(r.distance), gaps: (r.accessGaps ?? []).length, gapMeters: Math.round((r.accessGaps ?? []).reduce((s: number, g: any) => s + g.distanceMeters, 0)), canNavigate: !!r.canNavigate, assumed: !!r.assumedConnections, estimatedWarning: (r.warnings ?? []).some((w: string) => /PRIVATE TEST MODE/.test(w)), closures: (r.closures ?? []).map((c: any) => c.id), network: r.network?.status, routedFlags: (r.segments ?? []).map((s: any) => s.isRouted).join("") };
const out: any = { assume: ASSUME, loop: {} };
const a = places[0];
const planned = await call({ op: "plan", start: { latitude: a.latitude, longitude: a.longitude }, miles: 3, proposed: false, now: NOW });
out.loop.plan = facts(planned);
if (planned.route) {
  const rev = await call({ op: "reverse", route: planned.route, now: NOW });
  const insp = await call({ op: "inspect", route: planned.route, now: NOW });
  const snap = await call({ op: "snapshot", route: planned.route, point: { latitude: a.latitude, longitude: a.longitude }, accuracy: 5, timestamp: NOW, progress: 0, resume: true, now: NOW });
  const rec = await call({ op: "recalculate", route: planned.route, now: NOW });
  out.loop.reverse = facts(rev); out.loop.inspect = facts(insp); out.loop.snapshotOk = snap.ok !== false; out.loop.recalculate = facts(rec);
  out.loop.from = a.label;
}
console.log(JSON.stringify(out));
