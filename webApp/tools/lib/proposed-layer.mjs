// The opt-in seam for PROPOSED trail geometry (planned paths that are not built). It is closed by default and opens only
// with evidence:
//
//  * the committed review manifest (data/web-proposed-trails.manifest.json, which holds NO geometry) lists exactly which
//    proposed segments may be admitted and the SHA-256 of each one's geometry, recomputed here from the geometry in hand;
//  * its `rights` block must say status "granted", with the basis, an evidence URL and the evidence file's SHA-256, who
//    granted it and when, the licence and its link, and the attribution. Anything else is a rights BLOCK: packaging stops
//    and says why, with the evidence, instead of quietly shipping less (docs/web/data-rights.md, "Six proposed segments").
//
// Geometry is never invented, merged, simplified or repaired: a segment is admitted exactly as extracted or the whole
// layer is refused. Admitted segments become their own layer ("proposed-trails"), status Proposed, off by default, routed
// only with the rider's explicit opt-in and never offered for navigation (the router enforces that).
import { createHash } from "node:crypto";
import { join } from "node:path";
import { repoRoot } from "./core.mjs";

export const PROPOSED_LAYER_ID = "proposed-trails";
export const PROPOSED_KIND = "proposed-trails-preview";
export const committedProposedManifestFile = join(
  repoRoot,
  "data",
  "web-proposed-trails.manifest.json",
);
export const proposedInputFile = join(
  repoRoot,
  "data",
  "generated",
  "mcgis-trails.normalized.json",
);

export class ProposedError extends Error {
  constructor(message, { blocked = false } = {}) {
    super(message);
    this.name = "ProposedError";
    this.blocked = blocked;
  }
}
const refuse = (message) => {
  throw new ProposedError(message);
};
const sha256Text = (text) => createHash("sha256").update(text).digest("hex");
export const geometryHash = (paths) => sha256Text(JSON.stringify(paths));
const text = (value) => typeof value === "string" && value.trim().length > 0;
const https = (value) => text(value) && /^https:\/\//i.test(value);
const finitePoint = (point) =>
  Array.isArray(point) &&
  point.length === 2 &&
  point.every((v) => typeof v === "number" && Number.isFinite(v)) &&
  Math.abs(point[0]) <= 180 &&
  Math.abs(point[1]) <= 90;

/**
 * The rights gate. Returns the rights facts when (and only when) they are complete and granted; otherwise throws a
 * ProposedError marked `blocked` whose message carries the blocker and the evidence a reviewer needs.
 */
export function requireRights(manifest) {
  if (manifest.schemaVersion !== 1)
    refuse("Unsupported proposed-trails manifest version.");
  const rights = manifest.rights;
  if (!rights || typeof rights !== "object")
    throw new ProposedError(
      "The proposed-trails manifest has no rights block, so proposed geometry cannot be packaged.",
      { blocked: true },
    );
  if (rights.status !== "granted") {
    const evidence = (rights.evidenceUrls ?? []).join(", ");
    throw new ProposedError(
      `Proposed trail geometry is rights-blocked (${rights.status ?? "no status"}): ${rights.blocker ?? "no basis recorded"}${evidence ? ` Evidence: ${evidence}.` : ""} Segments affected: ${(manifest.features ?? []).map((f) => f.id).join(", ")}.`,
      { blocked: true },
    );
  }
  const missing = [
    ["basis", text(rights.basis)],
    ["evidenceUrl", https(rights.evidenceUrl)],
    [
      "evidenceSha256",
      typeof rights.evidenceSha256 === "string" &&
        /^[0-9a-f]{64}$/.test(rights.evidenceSha256),
    ],
    ["grantedBy", text(rights.grantedBy)],
    ["grantedOn", text(rights.grantedOn)],
    ["license", text(rights.license)],
    ["licenseUrl", https(rights.licenseUrl)],
    ["attribution", text(rights.attribution)],
  ]
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (missing.length)
    throw new ProposedError(
      `The proposed-trails rights block says granted but is incomplete (${missing.join(", ")}).`,
      { blocked: true },
    );
  return {
    basis: rights.basis,
    evidenceUrl: rights.evidenceUrl,
    evidenceSha256: rights.evidenceSha256,
    grantedBy: rights.grantedBy,
    grantedOn: rights.grantedOn,
    license: rights.license,
    licenseUrl: rights.licenseUrl,
    attribution: rights.attribution,
  };
}

const listed = (manifest) => {
  const entries = new Map();
  for (const entry of manifest.features ?? []) {
    if (!/^\d+:\d+$/.test(entry.id ?? ""))
      refuse("The proposed-trails manifest has an invalid segment id.");
    if (entries.has(entry.id))
      refuse(`The proposed-trails manifest lists ${entry.id} twice.`);
    if (!/^[0-9a-f]{64}$/.test(entry.geometrySha256 ?? ""))
      refuse(
        `${entry.id} has no geometry hash in the proposed-trails manifest.`,
      );
    entries.set(entry.id, entry);
  }
  if (entries.size === 0)
    refuse("The proposed-trails manifest lists no segments.");
  return entries;
};

/**
 * Admits exactly the manifest's proposed segments from a normalized extract, after the rights gate. Every segment must be
 * present once, be Proposed, have a geometry whose recomputed hash is the reviewed one, and nothing else is taken.
 */
export function admitProposed(inputText, manifest) {
  const rights = requireRights(manifest);
  const entries = listed(manifest);
  let input;
  try {
    input = JSON.parse(inputText.replace(/^﻿/, ""));
  } catch {
    refuse("The proposed-trails extract is not valid JSON.");
  }
  const found = new Map();
  for (const layer of input.layers ?? [])
    for (const feature of layer.features ?? []) {
      if (!entries.has(feature.id)) continue;
      if (found.has(feature.id))
        refuse(`${feature.id} appears more than once.`);
      found.set(feature.id, feature);
    }
  const features = [];
  for (const [id, entry] of entries) {
    const feature = found.get(id);
    if (!feature) refuse(`${id} is in the manifest but not in the extract.`);
    if (feature.status !== "Proposed")
      refuse(`${id} is not a Proposed segment in the extract.`);
    const paths = feature.paths;
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      !paths.every(
        (path) =>
          Array.isArray(path) && path.length >= 2 && path.every(finitePoint),
      )
    )
      refuse(`${id} has geometry that cannot be used as extracted.`);
    if (geometryHash(paths) !== entry.geometrySha256)
      refuse(`${id} has geometry that does not match its reviewed hash.`);
    features.push({
      id,
      name: feature.name ?? null,
      status: "Proposed",
      // Always opt-in, whatever the extract said: a proposed segment is never enabled by default.
      routeRoles: [
        ...new Set([...(feature.routeRoles ?? []), "ProposedTrails"]),
      ],
      facilityType: feature.facilityType ?? null,
      comfort: feature.comfort ?? null,
      surfaceType: feature.surfaceType ?? null,
      enabledByDefault: false,
      paths,
      provenance: {
        source: "Proposed trail segment (preview only)",
        geometrySha256: entry.geometrySha256,
        rightsEvidenceUrl: rights.evidenceUrl,
        rightsEvidenceSha256: rights.evidenceSha256,
        license: rights.license,
        licenseUrl: rights.licenseUrl,
        attribution: rights.attribution,
      },
    });
  }
  return {
    layer: {
      id: PROPOSED_LAYER_ID,
      name: "Proposed trails (preview only)",
      features,
    },
    facts: {
      id: PROPOSED_KIND,
      layerId: PROPOSED_LAYER_ID,
      featureCount: features.length,
      segmentIds: features.map((f) => f.id),
      reviewedOn: manifest.reviewedOn,
      ...rights,
      note: "Planned paths that may not be built or usable. They are routed only on request and are never offered for navigation.",
    },
  };
}

/**
 * Audits a packaged proposed layer against the manifest again, from the shipped bytes: same rights gate, same segments,
 * recomputed geometry hashes, off by default, record and layer agreeing.
 */
export function checkProposedLayer(layer, record, manifest, manifestBytes) {
  const rights = requireRights(manifest);
  const entries = listed(manifest);
  const part = record.proposedLayer;
  if (!part || part.id !== PROPOSED_KIND || part.layerId !== PROPOSED_LAYER_ID)
    refuse("The record does not describe the proposed-trails layer it ships.");
  if (part.manifestSha256 !== sha256Text(manifestBytes.toString("utf8")))
    refuse(
      "The proposed-trails layer was made from a different manifest than the committed one.",
    );
  const ids = layer.features.map((f) => f.id);
  if (
    ids.length !== entries.size ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => entries.has(id))
  )
    refuse("The proposed layer is not exactly the reviewed segments.");
  for (const feature of layer.features) {
    const entry = entries.get(feature.id);
    if (
      feature.status !== "Proposed" ||
      feature.enabledByDefault !== false ||
      !feature.routeRoles.includes("ProposedTrails")
    )
      refuse(`${feature.id} is not an opt-in Proposed segment.`);
    if (
      geometryHash(feature.paths) !== entry.geometrySha256 ||
      feature.provenance?.geometrySha256 !== entry.geometrySha256
    )
      refuse(
        `${feature.id} has geometry that does not match its reviewed hash.`,
      );
    if (
      feature.provenance?.rightsEvidenceSha256 !== rights.evidenceSha256 ||
      feature.provenance?.license !== rights.license
    )
      refuse(
        `${feature.id} does not carry the granted rights it was admitted under.`,
      );
  }
  if (
    part.featureCount !== layer.features.length ||
    JSON.stringify(part.segmentIds) !== JSON.stringify(ids) ||
    part.evidenceSha256 !== rights.evidenceSha256 ||
    part.license !== rights.license
  )
    refuse("The record's description of the proposed layer is wrong.");
  return layer.features.length;
}
