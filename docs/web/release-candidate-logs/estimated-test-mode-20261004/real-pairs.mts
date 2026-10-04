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
const out: any = { assume: ASSUME, pairs: [], extras: {} };
for (const a of places) for (const b of places) {
  if (a === b) continue;
  const r = await call({ op: "plan", start: { latitude: a.latitude, longitude: a.longitude }, destination: { latitude: b.latitude, longitude: b.longitude }, proposed: false, now: NOW });
  const f: any = { from: a.label, to: b.label, ...facts(r) };
  if (r.route && f.gaps > 0) {
    const route = r.route;
    const insp = await call({ op: "inspect", route, now: NOW });
    const snap = await call({ op: "snapshot", route, point: { latitude: a.latitude, longitude: a.longitude }, accuracy: 5, timestamp: NOW, progress: 0, resume: true, now: NOW });
    const rec = await call({ op: "recalculate", route, now: NOW });
    const rev = await call({ op: "reverse", route, now: NOW });
    f.inspect = facts(insp); f.snapshotOk = snap.ok !== false; f.snapshotError = snap.ok === false ? snap.error : null;
    f.recalculate = facts(rec); f.reverse = facts(rev);
  }
  out.pairs.push(f);
}
// Willow closure: a gap-free before/after route stays blocked in both modes at activation
const V97 = { latitude: 40.5096012799, longitude: -88.9843690241 }, V98 = { latitude: 40.516684074, longitude: -88.9849653323 };
const W = Date.parse("2026-10-05T11:00:00Z");
const before = await call({ op: "plan", start: V97, destination: V98, proposed: false, now: W - 1 });
const atAct = before.route ? await call({ op: "inspect", route: before.route, now: W }) : null;
out.extras.willow = { before: facts(before), atActivation: atAct ? facts(atAct) : null };
// A route with a gap that ALSO crosses the closure: plan from far off the trail across Willow at activation
const farA = { latitude: V97.latitude - 0.0008, longitude: V97.longitude - 0.0006 }, farB = { latitude: V98.latitude + 0.0008, longitude: V98.longitude + 0.0006 };
const gapClosed = await call({ op: "plan", start: farA, destination: farB, proposed: false, now: W - 1 });
const gapClosedAt = gapClosed.route ? await call({ op: "inspect", route: gapClosed.route, now: W }) : null;
out.extras.gapRouteAcrossWillow = { before: facts(gapClosed), atActivation: gapClosedAt ? facts(gapClosedAt) : null };
// No candidate: points far outside the network
const none = await call({ op: "plan", start: { latitude: 40.9, longitude: -89.9 }, destination: { latitude: 40.95, longitude: -89.8 }, proposed: false, now: NOW });
out.extras.noCandidate = facts(none);
writeFileSync(`C:/Temp/etm-${ASSUME ? "on" : "off"}.json`, JSON.stringify(out, null, 1));
console.log("done", ASSUME, out.pairs.length);
