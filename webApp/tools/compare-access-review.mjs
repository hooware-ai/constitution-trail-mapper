// Compare a fresh raw extract to v5's independently verified derived access package.
// Old raw tags/timestamps are unavailable: this is router-visible content and order only.
// node tools/compare-access-review.mjs <fresh.json> <v5-dist-data-directory> <report.json>
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildAccessParts } from "./lib/access-package.mjs";

const [input, baselineDirectory, output] = process.argv.slice(2);
if (!input || !baselineDirectory || !output)
  throw new Error("Expected fresh input, v5 data directory and output report");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const oldIndexSha =
  "672e9d1c871121c97896e03fe1825f228a8024ebc386270eba0d8b67008536e0";
const oldIndexBytes = await readFile(
  join(baselineDirectory, `access-index.${oldIndexSha.slice(0, 12)}.json`),
);
if (sha(oldIndexBytes) !== oldIndexSha)
  throw new Error("v5 index differs from independently recorded baseline");
const oldIndex = JSON.parse(oldIndexBytes);
const oldBase = await readFile(join(baselineDirectory, oldIndex.base.file));
if (sha(oldBase) !== oldIndex.base.sha256)
  throw new Error("v5 base hash mismatch");
const oldFeatures = new Map();
for (const tile of oldIndex.tiles) {
  const bytes = await readFile(join(baselineDirectory, tile.file));
  if (sha(bytes) !== tile.sha256)
    throw new Error(`v5 tile hash mismatch: ${tile.file}`);
  for (const feature of JSON.parse(bytes).layers[0].features) {
    const previous = oldFeatures.get(feature.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(feature))
      throw new Error("Conflicting v5 tile copies");
    oldFeatures.set(feature.id, feature);
  }
}
if (oldFeatures.size !== oldIndex.localFeatureCount)
  throw new Error("v5 local count mismatch");
const oldOrdered = [...oldFeatures.values()].sort((a, b) => a.ord - b.ord);
if (oldOrdered.some((f, ord) => f.ord !== ord))
  throw new Error("v5 source order is incomplete");
const raw = await readFile(input);
const capture = JSON.parse(await readFile(join(input, "..", "capture.json")));
if (
  capture.status !== "captured-and-audited-not-admitted" ||
  capture.normalizedSha256 !== sha(raw)
) {
  throw new Error(
    "Comparison requires the audited capture's exact normalized input",
  );
}
for (const toolPath of [
  "webApp/tools/compare-access-review.mjs",
  "webApp/tools/lib/access-package.mjs",
]) {
  const recorded = capture.tools.find((tool) => tool.file === toolPath);
  const currentBytes = await readFile(
    new URL(
      toolPath === "webApp/tools/compare-access-review.mjs"
        ? "./compare-access-review.mjs"
        : "./lib/access-package.mjs",
      import.meta.url,
    ),
  );
  if (!recorded || recorded.sha256 !== sha(currentBytes))
    throw new Error(
      "Comparison/transform tool differs from captured review revision",
    );
}
const built = buildAccessParts(raw.toString("utf8"));
const oldTiger = new Map(
  JSON.parse(oldBase)
    .layers.flatMap((layer) => layer.features)
    .map((f) => [f.id, f]),
);
const freshTiger = new Map(
  JSON.parse(built.base.body)
    .layers.flatMap((layer) => layer.features)
    .map((f) => [f.id, f]),
);
const current = JSON.parse(raw).layers.find(
  (layer) => layer.id === "osm-service",
).features;
const freshFeatures = new Map(current.map((f) => [f.id, f]));
const shared = oldOrdered.filter((f) => freshFeatures.has(f.id));
const changedGeometryIds = [],
  changedNameOrClassIds = [];
for (const old of shared) {
  const fresh = freshFeatures.get(old.id);
  if (JSON.stringify(old.paths) !== JSON.stringify(fresh.paths))
    changedGeometryIds.push(old.id);
  if (
    (old.name ?? null) !== (fresh.name ?? null) ||
    (old.mtfcc ?? null) !== (fresh.mtfcc ?? null)
  )
    changedNameOrClassIds.push(old.id);
}
const report = {
  schemaVersion: 1,
  oldDerivedIndexSha256: oldIndexSha,
  oldDerivedLocalCount: oldFeatures.size,
  freshInputSha256: sha(raw),
  captureManifestSha256: sha(await readFile(join(input, "..", "capture.json"))),
  sourceCommit: capture.sourceCommit,
  tools: capture.tools.filter((tool) => tool.file.startsWith("webApp/")),
  freshLocalCount: current.length,
  tigerBaseByteIdentical: oldBase.equals(built.base.body),
  tigerChanges: {
    addedIds: [...freshTiger.keys()].filter((id) => !oldTiger.has(id)),
    removedIds: [...oldTiger.keys()].filter((id) => !freshTiger.has(id)),
    changedIds: [...oldTiger.keys()].filter(
      (id) =>
        freshTiger.has(id) &&
        JSON.stringify(oldTiger.get(id)) !== JSON.stringify(freshTiger.get(id)),
    ),
  },
  addedIds: current.filter((f) => !oldFeatures.has(f.id)).map((f) => f.id),
  removedIds: oldOrdered
    .filter((f) => !freshFeatures.has(f.id))
    .map((f) => f.id),
  changedGeometryIds,
  changedNameOrClassIds,
  sharedRelativeOrderPreserved:
    JSON.stringify(shared.map((f) => f.id)) ===
    JSON.stringify(
      current.filter((f) => oldFeatures.has(f.id)).map((f) => f.id),
    ),
  transform: built.descriptor,
  // Explicit order: base, index, then tiles in the deterministic index cell order.
  combinedAccessPartsSha256: sha(
    Buffer.concat([
      built.base.body,
      built.index.body,
      ...built.tiles.map((tile) => tile.body),
    ]),
  ),
  limits:
    "Old raw source unavailable. Comparison authenticates v5 derived base/index/tile bytes and router-visible geometry/name/class/order; old access tags, source timestamps and raw-byte equivalence are unverified.",
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
