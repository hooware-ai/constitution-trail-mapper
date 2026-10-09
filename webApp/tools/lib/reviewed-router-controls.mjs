// Executes verified compiled Kotlin dispatch, never a supplied mock or claimed test report.
import { pathToFileURL } from "node:url";
import { coreEntry, verifyCoreManifest, sha256 } from "./core.mjs";
import { canonicalSha256 } from "./canonical-json.mjs";
import { verifySnapshot, snapshotIdentity } from "./reviewed-refresh.mjs";
const refuse = (message) => {
  throw new Error(`Router admission refused: ${message}`);
};
const same = (a, b) => canonicalSha256(a) === canonicalSha256(b);
export function bindCompiledCatalog(ledger, catalog) {
  if (
    catalog.schema !== "trail-mapper.compiled-closures/1" ||
    !Array.isArray(catalog.closures)
  )
    refuse("incompatible compiled catalog");
  const ids = catalog.closures.map((c) => c.id);
  if (
    new Set(ids).size !== ids.length ||
    new Set(ledger.closures.map((c) => c.id)).size !== ledger.closures.length ||
    !same([...ids].sort(), ledger.closures.map((c) => c.id).sort())
  )
    refuse("review ledger differs from complete compiled closure catalog");
  for (const closure of catalog.closures) {
    const entry = ledger.closures.find((c) => c.id === closure.id);
    if (
      !same(entry.compiledClosure, closure) ||
      entry.compiledSha256 !== canonicalSha256(closure) ||
      !same(entry.affectedIds, [closure.featureId])
    )
      refuse(`compiled rule differs from exact reviewed closure ${closure.id}`);
  }
  return canonicalSha256(catalog.closures);
}
export async function runReviewedRouterControls({
  report,
  snapshot,
  cases,
  now,
}) {
  verifySnapshot(snapshot);
  if (
    !same(report.target, snapshotIdentity(snapshot)) ||
    !same(report.ledger.dataset, report.target)
  )
    refuse("report/package identity mismatch");
  if (!Array.isArray(cases) || !Number.isSafeInteger(now))
    refuse("invalid control inputs");
  const required = [
    "point",
    "loop",
    "disconnected",
    "unverified-access",
    "closure",
    "saved-route",
  ];
  if (required.some((category) => !cases.some((c) => c.category === category)))
    refuse("missing representative router control category");
  const manifest = await verifyCoreManifest();
  const core = await import(pathToFileURL(coreEntry).href);
  const call = (request) => JSON.parse(core.dispatch(JSON.stringify(request)));
  const catalog = call({ op: "closureCatalog" });
  if (catalog.ok !== true)
    refuse("core does not expose complete compiled closure catalog");
  const catalogSha256 = bindCompiledCatalog(report.ledger, catalog);
  const record = snapshot.record;
  let accessLoader = null,
    accessPointsOf = null;
  if (record.access) {
    const { tsImport } = await import("tsx/esm/api");
    const access = await tsImport("../../src/accessTiles.ts", import.meta.url);
    accessPointsOf = access.accessPointsOf;
    accessLoader = new access.AccessLoader(record.access, {
      fetchBytes: async (name) => {
        const bytes = snapshot.parts?.[name];
        if (!bytes) refuse(`missing admitted access part ${name}`);
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
      },
      sha256Hex: async (bytes) => sha256(Buffer.from(bytes)),
      dispatch: call,
    });
  }
  const init = call({
    op: "initialize",
    trails: snapshot.body.toString("utf8"),
    dataset: {
      kind: record.kind,
      id: record.id,
      version: record.version,
      contentSha256: record.content.sha256,
    },
    access: accessLoader ? await accessLoader.baseText() : undefined,
    trustSerializedRoutes: false,
    assumeEstimatedConnections: false,
    now,
  });
  if (init.ok !== true) refuse(`core initialize failed: ${init.error}`);
  const saved = new Map();
  const results = [];
  for (const c of cases) {
    if (
      typeof c.id !== "string" ||
      !c.id ||
      results.some((r) => r.id === c.id) ||
      !required.includes(c.category) ||
      !["plan", "inspect", "snapshot", "recalculate"].includes(c.request?.op) ||
      !Array.isArray(c.assertions) ||
      !c.assertions.length
    )
      refuse("invalid router control");
    const request = structuredClone(c.request);
    if (c.routeFrom) {
      if (!saved.has(c.routeFrom)) refuse("unknown saved control route");
      request.route = saved.get(c.routeFrom);
    }
    if (
      request.assumeEstimatedConnections === true ||
      request.proposed === true
    )
      refuse("control cannot enable estimated access or Proposed");
    if (accessLoader) await accessLoader.ensure(accessPointsOf(request));
    const result = call(request);
    if (result.ok !== true)
      refuse(`control ${c.id} failed dispatch: ${result.error}`);
    const valid = {
      point:
        request.op === "plan" &&
        request.destination &&
        result.route &&
        result.canNavigate === true,
      loop:
        request.op === "plan" &&
        Number.isFinite(request.miles) &&
        result.route?.kind === "ExerciseLoop" &&
        result.canNavigate === true,
      disconnected:
        request.op === "plan" &&
        request.destination &&
        !result.route &&
        typeof result.error === "string" &&
        result.canNavigate === false,
      "unverified-access":
        request.op === "plan" &&
        result.route &&
        result.canNavigate === false &&
        result.accessGaps?.length > 0,
      closure:
        ["inspect", "snapshot"].includes(request.op) &&
        c.routeFrom &&
        result.canNavigate === false &&
        result.closures?.length > 0,
      "saved-route":
        request.op === "inspect" &&
        c.routeFrom &&
        result.network?.status === "current",
    };
    if (!valid[c.category])
      refuse(`control ${c.id} does not exercise ${c.category}`);
    for (const a of c.assertions) {
      if (
        !Array.isArray(a.path) ||
        !a.path.length ||
        a.path.some(
          (key) =>
            typeof key !== "string" ||
            ["__proto__", "constructor", "prototype"].includes(key),
        )
      )
        refuse("invalid assertion path");
      const actual = a.path.reduce((v, key) => v?.[key], result);
      if (actual === undefined || !same(actual, a.equals))
        refuse(
          `control ${c.id} failed ${a.path.join(".")}: ${JSON.stringify(actual)}`,
        );
    }
    if (c.saveAs) {
      if (!result.route || saved.has(c.saveAs))
        refuse("invalid saved-route control");
      saved.set(c.saveAs, result.route);
    }
    results.push({
      id: c.id,
      category: c.category,
      request,
      assertions: c.assertions,
      responseSha256: canonicalSha256(result),
      canNavigate: result.canNavigate ?? false,
      blockingClosureIds: (result.closures ?? []).map((c) => c.id).sort(),
      sourceFeatureIds: [
        ...new Set(
          (result.route ?? request.route)?.edges
            ?.map((e) => e.sourceFeatureId)
            .filter(Boolean) ?? [],
        ),
      ].sort(),
    });
  }
  for (const review of report.reviews) {
    if (review.decision.decision !== "accept") continue;
    const candidate = review.candidate;
    if (
      candidate.kind === "closure" &&
      !results.some(
        (c) =>
          c.category === "closure" &&
          c.blockingClosureIds.includes(candidate.closureId) &&
          candidate.affectedIds.every((id) => c.sourceFeatureIds.includes(id)),
      )
    )
      refuse("missing exact accepted closure gate control");
    if (
      candidate.kind === "reopening" &&
      !results.some(
        (c) =>
          c.category === "saved-route" &&
          c.canNavigate === true &&
          candidate.affectedIds.every((id) => c.sourceFeatureIds.includes(id)),
      )
    )
      refuse("missing exact authoritative reopening saved-route control");
  }
  await verifyCoreManifest();
  return {
    schema: "trail-mapper.router-admission/1",
    reviewSha256: canonicalSha256(report),
    dataset: report.target,
    core: {
      inputsSha256: manifest.inputs.sha256,
      outputsSha256: manifest.outputs.sha256,
    },
    catalogSha256,
    accessFiles: accessLoader?.fetched ?? [],
    cases: results,
    approved: false,
    blockers: [
      "Owner release approval and existing composition/provider/device gates remain required",
    ],
  };
}
