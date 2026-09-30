// Packages the reviewed, licensed county trails for the web app and audits the result.
//
// Input is the private, ignored output of tools/fetch-web-review-data.py (data/generated/web-licensed-trails.normalized.json);
// the reviewed manifest (data/web-reviewed-trails.manifest.json) is the only list of what may be admitted. This module
// never widens that list: it verifies each admitted feature against the manifest and refuses the whole package on any
// drift, extra layer, omitted-feature leak or missing evidence. Output is deterministic for a given input.
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256, repoRoot, webRoot } from "./core.mjs";
import {
  canonical,
  parseWithNumbers,
  sha256Text,
  toPlain,
} from "./canonical-json.mjs";

export const NETWORK_SCHEMA = "trail-mapper.network/1";
export const RECORD_SCHEMA = "trail-mapper.dataset/1";
export const packageDir = process.env.TRAIL_COUNTY_DIR
  ? resolve(process.env.TRAIL_COUNTY_DIR)
  : join(webRoot, "generated", "county");
// TRAIL_COUNTY_MANIFEST is a test hook so the synthetic package can be built and served; the release audit refuses
// to treat a package made from anything other than the committed manifest as the real county candidate.
export const committedManifestFile = join(
  repoRoot,
  "data",
  "web-reviewed-trails.manifest.json",
);
export const manifestFile = process.env.TRAIL_COUNTY_MANIFEST
  ? resolve(process.env.TRAIL_COUNTY_MANIFEST)
  : committedManifestFile;
export const licensedInputFile = join(
  repoRoot,
  "data",
  "generated",
  "web-licensed-trails.normalized.json",
);
export const committedApprovalFile = join(
  webRoot,
  "release",
  "dataset.county.json",
);
export const approvalRecordFile = process.env.TRAIL_COUNTY_APPROVAL
  ? resolve(process.env.TRAIL_COUNTY_APPROVAL)
  : committedApprovalFile;

export class AdmissionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdmissionError";
  }
}
const refuse = (message) => {
  throw new AdmissionError(message);
};
const sameSet = (a, b) =>
  a.size === b.size && [...a].every((value) => b.has(value));
const finitePoint = (point) =>
  Array.isArray(point) &&
  point.length === 2 &&
  point.every((v) => typeof v === "number" && Number.isFinite(v)) &&
  Math.abs(point[0]) <= 180 &&
  Math.abs(point[1]) <= 90;

/** Every ID the manifest admits, as "layer:objectId", with its roles and evidence hashes. */
export function admittedFeatures(manifest) {
  if (manifest.schemaVersion !== 1)
    refuse("Unsupported reviewed manifest version.");
  if (manifest.license !== "CC BY 4.0")
    refuse("The reviewed manifest is not for the CC BY 4.0 source.");
  const entries = new Map();
  for (const entry of manifest.features ?? []) {
    const id = `${entry.selectionLayerId}:${entry.objectId}`;
    if (entries.has(id)) refuse(`The manifest lists ${id} twice.`);
    entries.set(id, entry);
  }
  if (entries.size !== manifest.reviewedFeatureCount)
    refuse("The manifest count does not match its entries.");
  return entries;
}

/** IDs the manifest says must stay out of the public network (as "layer:objectId"). */
export function excludedIds(manifest) {
  return new Set(
    (manifest.excludedUntilVerified ?? []).flatMap((entry) =>
      (entry.objectIds ?? []).map(
        (objectId) => `${entry.selectionLayerId}:${objectId}`,
      ),
    ),
  );
}

/** The source attribute fields the reviewed attributes hash covers (tools/fetch-web-review-data.py ATTRIBUTE_FIELDS). */
export const ATTRIBUTE_FIELDS = [
  "OBJECTID",
  "FACILITYID",
  "NAME",
  "LENGTH",
  "SURFTYPE",
  "loc",
  "facilitytype",
  "activitytype",
  "systemname",
];
const codeText = (value) => (value == null ? null : String(value));
const cleanName = (value) => String(value ?? "").trim() || null;

/**
 * Recomputes what a feature's reviewed evidence hashes cover from the data actually in hand (its geometry, and the raw
 * source attributes) and compares them with the manifest. A hash label copied next to the data proves nothing.
 */
export function authenticateEvidence(id, entry, pathsTree, attributesTree) {
  if (sha256Text(canonical(pathsTree)) !== entry.geometrySha256)
    refuse(`${id} has geometry that does not match its reviewed evidence.`);
  if (
    !attributesTree ||
    typeof attributesTree !== "object" ||
    Array.isArray(attributesTree) ||
    Object.keys(attributesTree).length !== ATTRIBUTE_FIELDS.length ||
    !ATTRIBUTE_FIELDS.every((field) => field in attributesTree)
  )
    refuse(
      `${id} carries no raw source attributes; regenerate the extract with the current python tools/fetch-web-review-data.py.`,
    );
  if (sha256Text(canonical(attributesTree)) !== entry.attributesSha256)
    refuse(`${id} has attributes that do not match its reviewed evidence.`);
  const raw = toPlain(attributesTree);
  if (raw.OBJECTID !== entry.objectId)
    refuse(`${id} carries attributes of a different source feature.`);
  return raw;
}

/** The same code must always mean the same label; a swapped label would change how a trail is described. */
export function labelConsistency() {
  const seen = { facilityType: new Map(), comfort: new Map() };
  return (id, kind, code, label) => {
    const known = seen[kind];
    if (known.has(code) && known.get(code) !== label)
      refuse(
        `${id} describes ${kind} code ${code} differently from other trails.`,
      );
    known.set(code, label);
  };
}
export { cleanName, codeText };

/** Admission: the extractor output must be exactly the reviewed subset, single licensed layer, nothing else. */
export function admit(inputText, manifest) {
  const tree = parseWithNumbers(inputText);
  const input = toPlain(tree);
  const entries = admittedFeatures(manifest);
  const excluded = excludedIds(manifest);
  if (!input || typeof input !== "object")
    refuse("The licensed extract is not readable.");
  const sources = input.sources ?? {};
  if (
    sources.license !== manifest.license ||
    sources.licenseUrl !== manifest.licenseUrl
  )
    refuse("The extract's license does not match the reviewed manifest.");
  if (
    sources.licensedItemId !== manifest.licensedItemId ||
    sources.licensedSourceUrl !== manifest.licensedSourceUrl
  )
    refuse("The extract does not identify the reviewed licensed source.");
  if (input.reviewedOn !== manifest.reviewedOn)
    refuse("The extract was made against a different review date.");
  if (
    !sources.attribution ||
    !sources.licenseEvidenceUrl ||
    !sources.disclaimer ||
    !sources.changes
  )
    refuse(
      "The extract lacks attribution, license evidence, disclaimer or change disclosure.",
    );
  if (!Array.isArray(input.layers) || input.layers.length !== 1)
    refuse(
      "The extract must contain exactly the one reviewed licensed layer: supplements and other layers are not admitted.",
    );
  const layer = input.layers[0];
  if (layer.id !== 8 || !Array.isArray(layer.features))
    refuse("The extract's layer is not the licensed layer 8.");
  const seen = new Set();
  const layerCounts = {};
  const features = [];
  const consistent = labelConsistency();
  for (const [index, feature] of layer.features.entries()) {
    const id = feature?.id;
    if (typeof id !== "string") refuse("A feature has no identifier.");
    if (excluded.has(id))
      refuse(
        `${id} is on the manifest's excluded list and must not be packaged.`,
      );
    const entry = entries.get(id);
    if (!entry) refuse(`${id} is not in the reviewed manifest.`);
    if (seen.has(id)) refuse(`${id} appears twice.`);
    seen.add(id);
    if (feature.status !== "Existing" || feature.statusCode !== "1")
      refuse(`${id} is not an existing trail.`);
    if (feature.sourceLayerId !== 8)
      refuse(`${id} does not come from the licensed layer.`);
    const roles = feature.routeRoles;
    if (
      !Array.isArray(roles) ||
      roles.length === 0 ||
      JSON.stringify(roles) !== JSON.stringify(entry.routeRoles)
    )
      refuse(`${id} has different routing roles than reviewed.`);
    const provenance = feature.provenance ?? {};
    if (
      provenance.geometrySha256 !== entry.geometrySha256 ||
      provenance.attributesSha256 !== entry.attributesSha256 ||
      provenance.selectionLayerId !== entry.selectionLayerId
    )
      refuse(`${id} does not match its reviewed evidence hashes.`);
    const featureTree = tree.layers[0].features[index];
    const raw = authenticateEvidence(
      id,
      entry,
      featureTree.paths,
      featureTree.provenance?.attributes,
    );
    if (
      feature.objectId !== entry.objectId ||
      feature.name !== cleanName(raw.NAME) ||
      feature.facilityId !== raw.FACILITYID ||
      feature.facilityTypeCode !== codeText(raw.facilitytype) ||
      feature.comfortCode !== codeText(raw.loc)
    )
      refuse(
        `${id} is described differently from its authenticated source attributes.`,
      );
    consistent(
      id,
      "facilityType",
      feature.facilityTypeCode,
      feature.facilityType,
    );
    consistent(id, "comfort", feature.comfortCode, feature.comfort);
    if (
      provenance.license !== manifest.license ||
      provenance.sourceUrl !== manifest.licensedSourceUrl
    )
      refuse(`${id} does not carry the reviewed license and source.`);
    if (
      !Array.isArray(feature.paths) ||
      feature.paths.length === 0 ||
      !feature.paths.every(
        (path) =>
          Array.isArray(path) && path.length >= 2 && path.every(finitePoint),
      )
    )
      refuse(`${id} has invalid geometry.`);
    layerCounts[entry.selectionLayerId] =
      (layerCounts[entry.selectionLayerId] ?? 0) + 1;
    features.push({
      ...feature,
      // The exact source text of what the hashes cover, spliced verbatim into the shipped network.
      pathsText: canonical(featureTree.paths),
      attributesText: canonical(featureTree.provenance.attributes),
    });
  }
  const missing = [...entries.keys()].filter((id) => !seen.has(id));
  if (missing.length)
    refuse(
      `${missing.length} reviewed features are missing from the extract (for example ${missing.slice(0, 3).join(", ")}).`,
    );
  if (
    !sameSet(
      new Set(Object.keys(layerCounts)),
      new Set(Object.keys(manifest.reviewedLayerCounts)),
    ) ||
    Object.entries(manifest.reviewedLayerCounts).some(
      ([layerId, n]) => layerCounts[layerId] !== n,
    )
  )
    refuse("The reviewed feature counts per layer changed.");
  return features;
}

/**
 * The runtime network as text: what the router reads plus the raw evidence the hashes cover. Geometry and attributes are
 * spliced in exactly as the extractor wrote them, so anyone can recompute the reviewed digests from the shipped file.
 */
export function toNetworkText(features) {
  const ordered = [...features].sort((a, b) => {
    const [la, oa] = a.id.split(":").map(Number);
    const [lb, ob] = b.id.split(":").map(Number);
    return la - lb || oa - ob;
  });
  const one = (feature) =>
    `{"id":${JSON.stringify(feature.id)},"name":${JSON.stringify(feature.name ?? null)},"status":"Existing",` +
    `"routeRoles":${JSON.stringify(feature.routeRoles)},"facilityType":${JSON.stringify(feature.facilityType ?? null)},` +
    `"comfort":${JSON.stringify(feature.comfort ?? null)},"paths":${feature.pathsText},` +
    `"provenance":{"geometrySha256":${JSON.stringify(feature.provenance.geometrySha256)},` +
    `"attributesSha256":${JSON.stringify(feature.provenance.attributesSha256)},"attributes":${feature.attributesText}}}`;
  return (
    `{"schema":${JSON.stringify(NETWORK_SCHEMA)},"layers":[{"id":8,"name":"Reviewed licensed McGIS trails",` +
    `"featureCount":${ordered.length},"features":[${ordered.map(one).join(",")}]}]}`
  );
}

export async function readApprovalRecord(file = approvalRecordFile) {
  const record = JSON.parse(await readFile(file, "utf8"));
  if (record.kind !== "county")
    refuse("The county approval record is not for a county dataset.");
  return record;
}

/**
 * Builds the two files that ship: a hash-named network file and the dataset record. Approval fields are copied
 * verbatim from the committed approval record; nothing here can mark a dataset approved.
 */
export async function buildPackage({
  inputText,
  manifest,
  manifestBytes,
  approval,
}) {
  const features = admit(inputText, manifest);
  const input = JSON.parse(inputText);
  const body = Buffer.from(toNetworkText(features), "utf8");
  const contentSha = sha256(body);
  const file = `trails.${contentSha.slice(0, 12)}.json`;
  const layerCounts = {};
  for (const feature of features) {
    const layerId = feature.id.split(":")[0];
    layerCounts[layerId] = (layerCounts[layerId] ?? 0) + 1;
  }
  const sources = input.sources;
  const record = {
    schema: RECORD_SCHEMA,
    kind: "county",
    id: approval.id,
    version: `${manifest.reviewedOn}.${contentSha.slice(0, 12)}`,
    label: approval.label,
    content: {
      file,
      schema: NETWORK_SCHEMA,
      sha256: contentSha,
      bytes: body.length,
      featureCount: features.length,
      layerCounts,
    },
    source: {
      reviewedOn: manifest.reviewedOn,
      // Extraction time is when our extractor ran, not when the county last changed anything.
      extractedAtUtc: input.generatedAtUtc,
      evidenceVerifiedAtUtc: manifest.evidenceVerifiedAtUtc ?? null,
      manifestSha256: sha256(manifestBytes),
      licensedItemId: manifest.licensedItemId,
      licensedSourceUrl: manifest.licensedSourceUrl,
      license: manifest.license,
      licenseUrl: manifest.licenseUrl,
      licenseEvidenceUrl: sources.licenseEvidenceUrl,
      licenseEvidenceSha256: sources.licenseEvidenceSha256 ?? null,
      attribution: approval.attribution,
      changes: sources.changes,
      disclaimer: sources.disclaimer,
    },
    omitted: {
      proposedFeatureIds: [...excludedIds(manifest)]
        .map((id) => Number(id.split(":")[1]))
        .sort((a, b) => a - b),
      supplements: approval.omitted.supplements,
      accessRoads: approval.omitted.accessRoads,
    },
    approval: {
      approved: approval.approved === true,
      approvedBy: approval.approvedBy ?? null,
      approvedOn: approval.approvedOn ?? null,
      blockers: [...(approval.blockers ?? [])],
    },
  };
  return { record, body, file };
}

/** Writes the package atomically: a failed run never leaves a half-written or mixed-version directory. */
export async function writePackage(
  { record, body, file },
  outDir = packageDir,
) {
  const staging = `${outDir}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, file), body);
  await writeFile(
    join(staging, "dataset.json"),
    JSON.stringify(record, null, 2) + "\n",
  );
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, ".."), { recursive: true });
  await rename(staging, outDir);
  return outDir;
}

export async function packageFromFiles({
  inputFile = licensedInputFile,
  manifestPath = manifestFile,
  approvalPath = approvalRecordFile,
  outDir = packageDir,
} = {}) {
  let inputBytes;
  try {
    inputBytes = await readFile(inputFile, "utf8");
  } catch {
    throw new AdmissionError(
      `The licensed extract is not present (${inputFile}). Generate it with \`python tools/fetch-web-review-data.py\`; this tool never contacts the county servers.`,
    );
  }
  const manifestBytes = await readFile(manifestPath);
  const built = await buildPackage({
    inputText: inputBytes.replace(/^﻿/, ""),
    manifest: JSON.parse(manifestBytes.toString("utf8")),
    manifestBytes,
    approval: await readApprovalRecord(approvalPath),
  });
  await writePackage(built, outDir);
  return built;
}

/**
 * Checks a dataset record and its network bytes against the reviewed manifest: hash, exact ID set, excluded IDs
 * absent, per-feature evidence, counts. Shared by the build step and the release audit of the built artifact.
 */
export function checkPackage(record, body, manifestBytes) {
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (record.schema !== RECORD_SCHEMA || record.kind !== "county")
    refuse("The dataset record is not a county record of this version.");
  if (
    sha256(body) !== record.content.sha256 ||
    body.length !== record.content.bytes
  )
    refuse("The packaged network does not match its recorded hash.");
  if (record.source.manifestSha256 !== sha256(manifestBytes))
    refuse(
      "The package was made from a different reviewed manifest than the one committed.",
    );
  const tree = parseWithNumbers(body.toString("utf8"));
  const network = toPlain(tree);
  if (network.schema !== NETWORK_SCHEMA)
    refuse("The packaged network has an unknown schema.");
  const entries = admittedFeatures(manifest);
  const excluded = excludedIds(manifest);
  const features = network.layers.flatMap((layer) => layer.features);
  const ids = new Set(features.map((f) => f.id));
  if (features.length !== ids.size || !sameSet(ids, new Set(entries.keys())))
    refuse("The packaged trails are not exactly the reviewed set.");
  for (const id of ids)
    if (excluded.has(id)) refuse(`${id} is excluded but present.`);
  const consistent = labelConsistency();
  const treeFeatures = tree.layers.flatMap((layer) => layer.features);
  for (const [index, feature] of features.entries()) {
    const entry = entries.get(feature.id);
    if (
      feature.status !== "Existing" ||
      feature.provenance?.geometrySha256 !== entry.geometrySha256 ||
      feature.provenance?.attributesSha256 !== entry.attributesSha256
    )
      refuse(`${feature.id} does not match its reviewed evidence.`);
    if (JSON.stringify(feature.routeRoles) !== JSON.stringify(entry.routeRoles))
      refuse(`${feature.id} has different routing roles than reviewed.`);
    // Recomputed from the shipped bytes: the geometry the router will use and the attributes it was described by.
    const raw = authenticateEvidence(
      feature.id,
      entry,
      treeFeatures[index].paths,
      treeFeatures[index].provenance?.attributes,
    );
    if (feature.name !== cleanName(raw.NAME))
      refuse(
        `${feature.id} is named differently from its authenticated source attributes.`,
      );
    consistent(
      feature.id,
      "facilityType",
      codeText(raw.facilitytype),
      feature.facilityType,
    );
    consistent(feature.id, "comfort", codeText(raw.loc), feature.comfort);
  }
  if (record.content.featureCount !== features.length)
    refuse("The recorded feature count is wrong.");
  return network;
}

/** Re-verifies a package on disk (used before it is bundled and again by the release audit). */
export async function verifyPackageDir(
  dir = packageDir,
  manifestPath = manifestFile,
) {
  const record = JSON.parse(await readFile(join(dir, "dataset.json"), "utf8"));
  const manifestBytes = await readFile(manifestPath);
  const body = await readFile(join(dir, record.content.file));
  const network = checkPackage(record, body, manifestBytes);
  const listing = await readdir(dir);
  const stray = listing.filter(
    (name) => name !== "dataset.json" && name !== record.content.file,
  );
  if (stray.length)
    refuse(`Unexpected files in the package: ${stray.join(", ")}.`);
  return { record, body, network };
}
