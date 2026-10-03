// The owner-approved COMPOSITION of a dataset: exactly which network, access roads, OpenStreetMap supplement and
// proposed layer an approval covers. It is one of four separate things (see access-source.mjs):
//   integrity (parts match their hashes), source review (inputs are the reviewed ones), owner composition approval
//   (this file), and publication/rights approval (the flags and blockers in release/dataset.county.json).
// A composition is a set of hashes. Matching one proves WHICH data would ship, never that shipping it is permitted.
//
// An approved build must carry an explicit committed expected composition. Absence binds: a build WITHOUT access
// roads has `null` access fields, and adding access roads later is a different composition that the old approval does
// not cover. Nothing here fills in an approved composition; approving one is an owner act in the committed record.
import { createHash } from "node:crypto";

export const COMPOSITION_FIELDS = [
  "networkSha256",
  "layerCounts",
  "accessBaseSha256",
  "accessIndexSha256",
  "accessCombinedSha256",
  "accessSourceInputSha256",
  "accessSourceManifestSha256",
  "supplementManifestSha256",
  "proposedManifestSha256",
];
const ACCESS_FIELDS = COMPOSITION_FIELDS.filter((f) => f.startsWith("access"));
const HEX = /^[0-9a-f]{64}$/;
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const sortedCounts = (counts) =>
  Object.fromEntries(
    Object.entries(counts ?? {}).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  );

/**
 * The composition of a package, reconstructed from what is actually in hand: the network bytes, the layers found in
 * them, the bytes of each access part and the bytes of the committed manifests. `readPart(name)` returns file bytes.
 */
export function reconstructComposition({
  record,
  body,
  network,
  readPart,
  osmManifestBytes = null,
  proposedManifestBytes = null,
  accessManifestBytes = null,
}) {
  const counts = {};
  for (const layer of network.layers ?? [])
    counts[layer.id] = (layer.features ?? []).length;
  const part = (entry) => {
    const bytes = readPart?.(entry.file);
    if (!bytes) throw new Error(`access part ${entry.file} is missing`);
    return sha256(bytes);
  };
  const access = record.access ?? null;
  const accessBase = access ? part(access.base) : null;
  const accessIndex = access ? part(access.index) : null;
  return {
    networkSha256: sha256(body),
    layerCounts: sortedCounts(counts),
    accessBaseSha256: accessBase,
    accessIndexSha256: accessIndex,
    accessCombinedSha256: access
      ? sha256(Buffer.from(`${sha256(body)}:${accessIndex}`, "utf8"))
      : null,
    accessSourceInputSha256: access?.source?.inputSha256 ?? null,
    accessSourceManifestSha256: access
      ? sha256(Buffer.from(accessManifestBytes ?? []))
      : null,
    supplementManifestSha256: (record.supplements ?? []).length
      ? sha256(Buffer.from(osmManifestBytes ?? []))
      : null,
    proposedManifestSha256: record.proposedLayer
      ? sha256(Buffer.from(proposedManifestBytes ?? []))
      : null,
  };
}

/** Why an expected composition is not a usable approval target (an empty list when it is well formed). */
export function compositionProblems(composition) {
  if (composition == null) return ["there is no expected composition"];
  if (typeof composition !== "object" || Array.isArray(composition))
    return ["the expected composition is not an object"];
  const problems = [];
  const keys = Object.keys(composition);
  for (const field of COMPOSITION_FIELDS)
    if (!(field in composition))
      problems.push(`the expected composition has no ${field}`);
  for (const key of keys)
    if (!COMPOSITION_FIELDS.includes(key))
      problems.push(`the expected composition has an unknown field ${key}`);
  if (problems.length) return problems;
  if (!HEX.test(composition.networkSha256 ?? ""))
    problems.push("the expected network SHA-256 is not a SHA-256");
  const counts = composition.layerCounts;
  if (
    !counts ||
    typeof counts !== "object" ||
    !Object.values(counts).every((n) => Number.isInteger(n) && n >= 0)
  )
    problems.push("the expected layer counts are not counts");
  for (const field of [
    ...ACCESS_FIELDS,
    "supplementManifestSha256",
    "proposedManifestSha256",
  ])
    if (composition[field] !== null && !HEX.test(composition[field] ?? ""))
      problems.push(`the expected ${field} is neither null nor a SHA-256`);
  // Access is all or nothing: a half-described access composition would leave part of it unbound.
  const present = ACCESS_FIELDS.filter((f) => composition[f] !== null);
  if (present.length !== 0 && present.length !== ACCESS_FIELDS.length)
    problems.push(
      "the expected access fields must all be null (no access roads) or all be set",
    );
  return problems;
}

/** The fields where the actual composition is not the approved one (empty when they are identical). */
export function compositionDifferences(actual, expected) {
  return COMPOSITION_FIELDS.filter(
    (field) =>
      JSON.stringify(actual?.[field]) !== JSON.stringify(expected?.[field]),
  );
}

/** Refusals/blockers for an APPROVED dataset: its committed expected composition must exist and equal the actual one. */
export function approvedCompositionProblems(actual, expected) {
  const bad = compositionProblems(expected);
  if (bad.length)
    return bad.map(
      (reason) => `approved dataset is not bound to a composition: ${reason}`,
    );
  if (!actual)
    return ["approved dataset's actual composition could not be reconstructed"];
  return compositionDifferences(actual, expected).map(
    (field) =>
      `dataset composition ${field} is not the approved composition (a changed, added or removed part needs a new owner approval)`,
  );
}
