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

import {
  PROPOSED_LAYER_ID,
  ProposedError,
  admitProposed,
  checkProposedLayer,
  committedProposedManifestFile,
  proposedInputFile,
} from "./proposed-layer.mjs";
import {
  AccessPackageError,
  buildAccessParts,
  checkAccessParts,
} from "./access-package.mjs";
import {
  AccessSourceError,
  admitAccessSource,
  checkAccessSource,
  checkAccessTransform,
  committedAccessManifestFile,
} from "./access-source.mjs";
import {
  approvedCompositionProblems,
  compositionDifferences,
  reconstructComposition,
} from "./composition.mjs";
import {
  SUPPLEMENT_KIND,
  SUPPLEMENT_LAYER_ID,
  SupplementError,
  admitSupplement,
  checkSupplementLayer,
  committedOsmManifestFile,
  osmInputFile,
} from "./osm-supplement.mjs";

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

// TRAIL_OSM_MANIFEST is a test hook like TRAIL_COUNTY_MANIFEST: the audit refuses a package made from any other manifest.
export const osmManifestFile = process.env.TRAIL_OSM_MANIFEST
  ? resolve(process.env.TRAIL_OSM_MANIFEST)
  : committedOsmManifestFile;
export const proposedManifestFile =
  process.env.TRAIL_PROPOSED_MANIFEST ?? committedProposedManifestFile;
// TRAIL_ACCESS_MANIFEST is a test hook like the others: a synthetic extract needs a synthetic (test-only) source
// manifest, and the release audit refuses a package made from any manifest other than the committed one.
export const accessManifestFile = process.env.TRAIL_ACCESS_MANIFEST
  ? resolve(process.env.TRAIL_ACCESS_MANIFEST)
  : committedAccessManifestFile;
export {
  committedAccessManifestFile,
  committedOsmManifestFile,
  osmInputFile,
  committedProposedManifestFile,
  proposedInputFile,
};

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

/** The coded-value domains the reviewed manifest pins by digest (licensedDomainsSha256). */
export function authenticateDomains(domainsTree, manifest) {
  if (
    !domainsTree ||
    typeof domainsTree !== "object" ||
    Array.isArray(domainsTree)
  )
    refuse(
      "The extract carries no source domain mapping; regenerate it with the current python tools/fetch-web-review-data.py.",
    );
  if (
    !manifest.licensedDomainsSha256 ||
    sha256Text(canonical(domainsTree)) !== manifest.licensedDomainsSha256
  )
    refuse(
      "The domain mapping does not match the reviewed domains digest; the source's field meanings changed or the extract was altered.",
    );
  return toPlain(domainsTree);
}

/** A decoded label is the reviewed domain's name for the authenticated code, never a value learned from the extract. */
export function labelFor(domains, field, code) {
  return code == null ? null : (domains[field]?.[code] ?? null);
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
  const domains = authenticateDomains(tree.sources?.domains, manifest);
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
    if (
      (feature.facilityType ?? null) !==
        labelFor(domains, "facilitytype", codeText(raw.facilitytype)) ||
      (feature.comfort ?? null) !== labelFor(domains, "loc", codeText(raw.loc))
    )
      refuse(
        `${id} carries decoded labels that differ from the reviewed domain mapping.`,
      );
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
  return { features, domainsText: canonical(tree.sources.domains) };
}

/**
 * The runtime network as text: what the router reads plus the raw evidence the hashes cover. Geometry and attributes are
 * spliced in exactly as the extractor wrote them, so anyone can recompute the reviewed digests from the shipped file.
 */
export function toNetworkText(
  features,
  domainsText,
  supplementLayer = null,
  proposedLayer = null,
) {
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
    `{"schema":${JSON.stringify(NETWORK_SCHEMA)},"domains":${domainsText},"layers":[{"id":8,"name":"Reviewed licensed McGIS trails",` +
    `"featureCount":${ordered.length},"features":[${ordered.map(one).join(",")}]}` +
    (supplementLayer ? `,${JSON.stringify(supplementLayer)}` : "") +
    (proposedLayer ? `,${JSON.stringify(proposedLayer)}` : "") +
    `]}`
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
  supplement = null,
  // Optional ordinary-road access: split into base roads (loaded with the data) and endpoint-local service-road tiles
  // (loaded on demand), every part hash-named and pinned by the record. Off unless given.
  access = null,
  // Optional, rights-gated proposed trails: their own opt-in layer, only with a granted rights block (proposed-layer.mjs).
  proposed = null,
}) {
  const { features, domainsText } = admit(inputText, manifest);
  const input = JSON.parse(inputText);
  // Optional, separately reviewed OpenStreetMap supplement: its own layer, its own source and licence record.
  const admittedSupplement = supplement
    ? admitSupplement(supplement.inputText, supplement.manifest)
    : null;
  let admittedProposed = null;
  try {
    admittedProposed = proposed
      ? admitProposed(proposed.inputText, proposed.manifest)
      : null;
  } catch (error) {
    if (error instanceof ProposedError) throw new AdmissionError(error.message);
    throw error;
  }
  const body = Buffer.from(
    toNetworkText(
      features,
      domainsText,
      admittedSupplement?.layer ?? null,
      admittedProposed?.layer ?? null,
    ),
    "utf8",
  );
  const contentSha = sha256(body);
  const file = `trails.${contentSha.slice(0, 12)}.json`;
  let accessParts = null;
  let accessSource = null;
  try {
    // Source review first: only the pinned extract is split into parts at all.
    if (access) {
      if (!access.manifestBytes)
        refuse(
          "Access roads need the reviewed access source manifest; none was given.",
        );
      accessSource = admitAccessSource(access.inputText, access.manifestBytes);
    }
    accessParts = access ? buildAccessParts(access.inputText) : null;
    // ...and the parts made from it must be the reviewed transform of that input, not merely well-formed.
    if (accessParts)
      checkAccessTransform(accessParts.descriptor, accessSource.manifest);
  } catch (error) {
    if (
      error instanceof AccessPackageError ||
      error instanceof AccessSourceError
    )
      throw new AdmissionError(error.message);
    throw error;
  }
  // The identity a saved route remembers moves with the access data it was planned on, not just the trails.
  const combinedSha = accessParts
    ? accessIdentity(contentSha, accessParts.descriptor.index.sha256)
    : null;
  const layerCounts = {};
  for (const feature of features) {
    const layerId = feature.id.split(":")[0];
    layerCounts[layerId] = (layerCounts[layerId] ?? 0) + 1;
  }
  if (admittedSupplement)
    layerCounts[SUPPLEMENT_LAYER_ID] = admittedSupplement.layer.features.length;
  if (admittedProposed)
    layerCounts[PROPOSED_LAYER_ID] = admittedProposed.layer.features.length;
  const totalFeatures =
    features.length +
    (admittedSupplement?.layer.features.length ?? 0) +
    (admittedProposed?.layer.features.length ?? 0);
  const sources = input.sources;
  const record = {
    schema: RECORD_SCHEMA,
    kind: "county",
    id: approval.id,
    version: `${manifest.reviewedOn}.${(combinedSha ?? contentSha).slice(0, 12)}`,
    label: approval.label,
    content: {
      file,
      schema: NETWORK_SCHEMA,
      sha256: contentSha,
      bytes: body.length,
      featureCount: totalFeatures,
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
      // Segments admitted through the rights-gated layer are no longer omitted.
      proposedFeatureIds: [...excludedIds(manifest)]
        .filter(
          (id) => !(admittedProposed?.facts.segmentIds ?? []).includes(id),
        )
        .map((id) => Number(id.split(":")[1]))
        .sort((a, b) => a - b),
      // What is left out, in words a rider can read. With a supplement packaged, the approval record's "none" no longer
      // applies; the reviewed exclusions are stated instead (gaps stay gaps).
      supplements: admittedSupplement
        ? `Included as a separate layer: ${admittedSupplement.facts.featureCount} reviewed OpenStreetMap paths (ODbL). Not included: ${admittedSupplement.facts.excludedUntilVerified.join(" ")}`
        : approval.omitted.supplements,
      accessRoads: accessParts
        ? `Included: ordinary-road access (${accessParts.descriptor.base.featureCount} base road features, and ${accessParts.descriptor.index.localFeatureCount} endpoint-local service roads loaded only around a trip's start and destination). Sources: U.S. Census Bureau TIGER/Line roads and OpenStreetMap contributors (ODbL). Access to a trail is routed along these roads where they exist and is otherwise shown as a labeled gap, never an invented connection.`
        : approval.omitted.accessRoads,
    },
    ...(admittedSupplement
      ? {
          supplements: [
            {
              ...admittedSupplement.facts,
              manifestSha256: sha256(supplement.manifestBytes),
            },
          ],
        }
      : {}),
    ...(accessParts
      ? {
          access: {
            ...accessParts.descriptor,
            combinedSha256: combinedSha,
            // Which reviewed input these roads were made from (source review; not rights, not publication approval).
            source: accessSource.source,
          },
        }
      : {}),
    ...(admittedProposed
      ? {
          proposedLayer: {
            ...admittedProposed.facts,
            manifestSha256: sha256(Buffer.from(proposed.manifestBytes)),
          },
        }
      : {}),
    approval: {
      approved: approval.approved === true,
      approvedBy: approval.approvedBy ?? null,
      approvedOn: approval.approvedOn ?? null,
      // The owner's committed expected composition, carried verbatim (null until an owner records one). Never filled in here.
      approvedComposition: approval.approvedComposition ?? null,
      blockers: [...(approval.blockers ?? [])],
    },
  };
  // The composition this build actually has, reconstructed from the parts just made, recorded beside the approval.
  const partBytes = new Map(
    (accessParts?.files ?? []).map((part) => [part.file, part.body]),
  );
  record.composition = reconstructComposition({
    record,
    body,
    network: JSON.parse(body.toString("utf8")),
    readPart: (name) => partBytes.get(name),
    manifestBytes,
    osmManifestBytes: supplement?.manifestBytes ?? null,
    proposedManifestBytes: proposed?.manifestBytes ?? null,
    accessManifestBytes: access?.manifestBytes ?? null,
  });
  // An approved build must be exactly the approved composition; a build that differs is refused, not shipped.
  if (approval.approved === true) {
    const problems = approvedCompositionProblems(
      record.composition,
      approval.approvedComposition,
    );
    if (problems.length) refuse(problems.join("; "));
  }
  return { record, body, file, accessFiles: accessParts?.files ?? [] };
}

/** The combined identity of a network and the tile index that pins its access roads. */
export const accessIdentity = (networkSha256, indexSha256) =>
  sha256(Buffer.from(`${networkSha256}:${indexSha256}`, "utf8"));

/** Writes the package atomically: a failed run never leaves a half-written or mixed-version directory. */
export async function writePackage(
  { record, body, file, accessFiles = [] },
  outDir = packageDir,
) {
  const staging = `${outDir}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, file), body);
  for (const part of accessFiles)
    await writeFile(join(staging, part.file), part.body);
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
  // Optional reviewed OpenStreetMap supplement: pass `osmInput` (its normalized file) to include it.
  osmInput = null,
  osmManifestPath = osmManifestFile,
  // Optional normalized access-road extract (TIGER roads plus endpoint-local service roads).
  accessInput = null,
  accessManifestPath = accessManifestFile,
  // Optional proposed-trails extract; requires a manifest whose rights block is granted, else packaging is refused.
  proposedInput = null,
  proposedManifestPath = proposedManifestFile,
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
  let supplement = null;
  if (osmInput) {
    let text;
    try {
      text = await readFile(osmInput, "utf8");
    } catch {
      throw new AdmissionError(
        `The OpenStreetMap supplement is not present (${osmInput}). Generate it with the native extractor (python tools/fetch-verified-trail-additions.py); this tool never contacts OpenStreetMap.`,
      );
    }
    const osmManifestBytes = await readFile(osmManifestPath);
    supplement = {
      inputText: text,
      manifest: JSON.parse(osmManifestBytes.toString("utf8").replace(/^﻿/, "")),
      manifestBytes: osmManifestBytes,
    };
  }
  let proposed = null;
  if (proposedInput) {
    let proposedText;
    try {
      proposedText = await readFile(proposedInput, "utf8");
    } catch {
      throw new AdmissionError(
        `The proposed-trails extract is not present (${proposedInput}); this tool never contacts a server.`,
      );
    }
    const proposedManifestBytes = await readFile(proposedManifestPath);
    proposed = {
      inputText: proposedText,
      manifest: JSON.parse(
        proposedManifestBytes.toString("utf8").replace(/^﻿/, ""),
      ),
      manifestBytes: proposedManifestBytes,
    };
  }
  let access = null;
  if (accessInput) {
    let text;
    try {
      text = await readFile(accessInput, "utf8");
    } catch {
      throw new AdmissionError(
        `The access road extract is not present (${accessInput}). Generate it with the native extractor; this tool never contacts a server.`,
      );
    }
    access = {
      inputText: text,
      manifestBytes: await readFile(accessManifestPath),
    };
  }
  const built = await buildPackage({
    inputText: inputBytes.replace(/^﻿/, ""),
    manifest: JSON.parse(manifestBytes.toString("utf8")),
    manifestBytes,
    approval: await readApprovalRecord(approvalPath),
    supplement,
    access,
    proposed,
  });
  await writePackage(built, outDir);
  return built;
}

/**
 * Checks a dataset record and its network bytes against the reviewed manifest: hash, exact ID set, excluded IDs
 * absent, per-feature evidence, counts. Shared by the build step and the release audit of the built artifact.
 */
export function checkPackage(
  record,
  body,
  manifestBytes,
  osmManifestBytes = null,
  // Returns the bytes of a package file by name (undefined when absent); required when the record has access parts.
  readPart = undefined,
  proposedManifestBytes = null,
  accessManifestBytes = null,
) {
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
  // The county layer(s) are the reviewed set; an OpenStreetMap supplement is its own layer, checked on its own terms.
  const supplementLayers = network.layers.filter(
    (layer) => layer.id === SUPPLEMENT_LAYER_ID,
  );
  const hasPart = (record.supplements ?? []).length > 0;
  if (
    hasPart !== (supplementLayers.length === 1) ||
    supplementLayers.length > 1
  )
    refuse(
      "The OpenStreetMap supplement layer and the record's description of it disagree.",
    );
  if ((record.supplements ?? []).some((part) => part.id !== SUPPLEMENT_KIND))
    refuse("The record describes a supplement this version does not know.");
  const proposedLayers = network.layers.filter(
    (layer) => layer.id === PROPOSED_LAYER_ID,
  );
  const hasProposed = Boolean(record.proposedLayer);
  if (
    hasProposed !== (proposedLayers.length === 1) ||
    proposedLayers.length > 1
  )
    refuse(
      "The proposed-trails layer and the record's description of it disagree.",
    );
  const countyLayers = network.layers.filter(
    (layer) =>
      layer.id !== SUPPLEMENT_LAYER_ID && layer.id !== PROPOSED_LAYER_ID,
  );
  const features = countyLayers.flatMap((layer) => layer.features);
  const ids = new Set(features.map((f) => f.id));
  if (features.length !== ids.size || !sameSet(ids, new Set(entries.keys())))
    refuse("The packaged trails are not exactly the reviewed set.");
  for (const id of ids)
    if (excluded.has(id)) refuse(`${id} is excluded but present.`);
  const domains = authenticateDomains(tree.domains, manifest);
  const treeFeatures = tree.layers
    .filter(
      (layer) =>
        layer.id !== SUPPLEMENT_LAYER_ID && layer.id !== PROPOSED_LAYER_ID,
    )
    .flatMap((layer) => layer.features);
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
    if (
      (feature.facilityType ?? null) !==
        labelFor(domains, "facilitytype", codeText(raw.facilitytype)) ||
      (feature.comfort ?? null) !== labelFor(domains, "loc", codeText(raw.loc))
    )
      refuse(
        `${feature.id} carries decoded labels that differ from the reviewed domain mapping.`,
      );
  }
  let supplementCount = 0;
  if (hasPart) {
    if (!osmManifestBytes)
      refuse(
        "The record has an OpenStreetMap supplement but no reviewed manifest to check it against.",
      );
    try {
      checkSupplementLayer(
        supplementLayers[0],
        record,
        JSON.parse(osmManifestBytes.toString("utf8").replace(/^﻿/, "")),
        osmManifestBytes,
      );
    } catch (error) {
      if (error instanceof SupplementError) refuse(error.message);
      throw error;
    }
    supplementCount = supplementLayers[0].features.length;
  }
  let proposedCount = 0;
  if (hasProposed) {
    if (!proposedManifestBytes)
      refuse(
        "The record has a proposed-trails layer but no reviewed manifest to check it against.",
      );
    try {
      proposedCount = checkProposedLayer(
        proposedLayers[0],
        record,
        JSON.parse(proposedManifestBytes.toString("utf8").replace(/^﻿/, "")),
        proposedManifestBytes,
      );
    } catch (error) {
      if (error instanceof ProposedError) refuse(error.message);
      throw error;
    }
  }
  if (
    record.content.featureCount !==
    features.length + supplementCount + proposedCount
  )
    refuse("The recorded feature count is wrong.");
  if (record.access) {
    if (!readPart)
      refuse(
        "The record describes access road parts but none were given to check.",
      );
    try {
      checkAccessParts(record.access, readPart);
    } catch (error) {
      if (error instanceof AccessPackageError) refuse(error.message);
      throw error;
    }
    if (!accessManifestBytes)
      refuse(
        "The record has access roads but no reviewed access source manifest to check them against.",
      );
    try {
      checkAccessSource(record.access, accessManifestBytes);
    } catch (error) {
      if (error instanceof AccessSourceError) refuse(error.message);
      throw error;
    }
    const combined = accessIdentity(
      record.content.sha256,
      record.access.index.sha256,
    );
    if (record.access.combinedSha256 !== combined)
      refuse(
        "The access identity does not match the network and its tile index.",
      );
    if (!record.version.endsWith(`.${combined.slice(0, 12)}`))
      refuse(
        "The dataset version does not name the combined network and access identity.",
      );
  } else if (!record.version.endsWith(`.${record.content.sha256.slice(0, 12)}`))
    refuse("The dataset version does not name the network content.");
  // Owner composition: what the record says it is must be what the parts and bytes actually are, and an approved record
  // must be bound to exactly that composition by an expected composition it carries.
  let actual;
  try {
    actual = reconstructComposition({
      record,
      body,
      network,
      readPart,
      manifestBytes,
      osmManifestBytes,
      proposedManifestBytes,
      accessManifestBytes,
    });
  } catch (error) {
    refuse(
      `The package composition could not be reconstructed: ${error.message}`,
    );
  }
  const drift = compositionDifferences(actual, record.composition);
  if (drift.length)
    refuse(
      `The record's composition differs from the package's actual parts (${drift.join(", ")}).`,
    );
  if (record.approval?.approved === true) {
    const problems = approvedCompositionProblems(
      actual,
      record.approval.approvedComposition,
    );
    if (problems.length) refuse(problems.join("; "));
  }
  return network;
}

/** Re-verifies a package on disk (used before it is bundled and again by the release audit). */
export async function verifyPackageDir(
  dir = packageDir,
  manifestPath = manifestFile,
  accessManifestPath = accessManifestFile,
) {
  const record = JSON.parse(await readFile(join(dir, "dataset.json"), "utf8"));
  const manifestBytes = await readFile(manifestPath);
  const body = await readFile(join(dir, record.content.file));
  const osmManifestBytes = (record.supplements ?? []).length
    ? await readFile(osmManifestFile)
    : null;
  const proposedManifestBytes = record.proposedLayer
    ? await readFile(proposedManifestFile)
    : null;
  const accessManifestBytes = record.access
    ? await readFile(accessManifestPath)
    : null;
  const listing = await readdir(dir);
  const present = new Map();
  for (const name of listing)
    if (name !== "dataset.json" && name !== record.content.file)
      present.set(name, await readFile(join(dir, name)));
  const used = new Map();
  const readPart = (name) => {
    const bytes = present.get(name);
    if (bytes) used.set(name, bytes);
    return bytes;
  };
  const network = checkPackage(
    record,
    body,
    manifestBytes,
    osmManifestBytes,
    readPart,
    proposedManifestBytes,
    accessManifestBytes,
  );
  const stray = [...present.keys()].filter((name) => !used.has(name));
  if (stray.length)
    refuse(`Unexpected files in the package: ${stray.join(", ")}.`);
  return { record, body, network, accessFiles: [...used] };
}
