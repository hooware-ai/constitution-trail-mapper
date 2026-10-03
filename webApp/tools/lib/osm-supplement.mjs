// Admission and verification of the reviewed OpenStreetMap supplement (the four hand-reviewed bicycle paths native also
// loads). It mirrors tools/lib/dataset-package.mjs for the county: the committed review manifest
// (data/verified-trail-additions.manifest.json, which holds NO geometry) is the only list of what may be admitted, and
// each way's geometry hash is RECOMPUTED from the geometry in hand, never trusted from a label next to it. Anything that
// drifts (a way added, missing, a changed version, tag, role, geometry or licence) refuses the whole supplement.
//
// What this does not decide: whether combining ODbL data with the CC BY county network in a published routing graph is a
// derivative database. That is the owner's decision (docs/web/data-rights.md); this module only keeps the supplement
// separable (its own layer, its own source/licence/attribution record) and exactly what was reviewed.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { repoRoot } from "./core.mjs";

export const SUPPLEMENT_LAYER_ID = "verified-osm";
export const SUPPLEMENT_KIND = "osm-reviewed-ways";
export const committedOsmManifestFile = join(
  repoRoot,
  "data",
  "verified-trail-additions.manifest.json",
);
export const osmInputFile = join(
  repoRoot,
  "data",
  "generated",
  "verified-trail-additions.normalized.json",
);
const ODBL = "Open Database License (ODbL) 1.0";
const ATTRIBUTION = "© OpenStreetMap contributors";
const ROLES = new Set(["TrailBranches", "ParkConnectors"]);

export class SupplementError extends Error {
  constructor(message) {
    super(message);
    this.name = "SupplementError";
  }
}
const refuse = (message) => {
  throw new SupplementError(message);
};
const sha256Text = (text) => createHash("sha256").update(text).digest("hex");
/** JSON text with every object's keys in a fixed order, so two descriptions can be compared whatever order they came in. */
const stable = (value) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );

const finitePoint = (point) =>
  Array.isArray(point) &&
  point.length === 2 &&
  point.every((v) => typeof v === "number" && Number.isFinite(v)) &&
  Math.abs(point[0]) <= 180 &&
  Math.abs(point[1]) <= 90;

/** The way ids the reviewed manifest admits, with their reviewed hashes, versions, roles and required tags. */
export function reviewedWays(manifest) {
  if (manifest.schemaVersion !== 1)
    refuse("Unsupported reviewed OpenStreetMap manifest version.");
  if (manifest.license !== ODBL || manifest.attribution !== ATTRIBUTION)
    refuse(
      "The reviewed OpenStreetMap manifest does not carry the ODbL notice.",
    );
  const ways = new Map();
  for (const entry of manifest.features ?? []) {
    if (!Number.isInteger(entry.wayId) || entry.wayId <= 0)
      refuse("The reviewed manifest has an invalid way id.");
    const id = `${SUPPLEMENT_LAYER_ID}:way:${entry.wayId}`;
    if (ways.has(id)) refuse(`The reviewed manifest lists ${id} twice.`);
    if (!ROLES.has(entry.routeRole))
      refuse(`${id} has an unreviewed routing role.`);
    if (!/^[0-9a-f]{64}$/.test(entry.geometrySha256 ?? ""))
      refuse(`${id} has no reviewed geometry hash.`);
    ways.set(id, entry);
  }
  if (!ways.size) refuse("The reviewed OpenStreetMap manifest admits no ways.");
  return ways;
}

/** What the reviewed manifest says must stay OUT: gaps are never bridged and unverified ways are never imported. */
export function exclusions(manifest) {
  const list = (manifest.excludedUntilVerified ?? []).map(String);
  if (!list.length)
    refuse(
      "The reviewed manifest records no exclusions; the known gaps must be carried so they stay gaps.",
    );
  return list;
}

/**
 * The geometry hash the reviewers pinned: SHA-256 of the compact JSON of the way's [lon, lat] points, exactly as the
 * extractor (tools/fetch-verified-trail-additions.py) computes it.
 */
export const geometryHash = (points) => sha256Text(JSON.stringify(points));

/**
 * Verifies a normalized supplement against the reviewed manifest and returns the layer to ship (an allow-listed copy
 * of each feature) plus the facts the dataset record states about it. Throws SupplementError on any drift.
 */
export function admitSupplement(inputText, manifest) {
  const ways = reviewedWays(manifest);
  const excluded = exclusions(manifest);
  let input;
  try {
    input = JSON.parse(inputText.replace(/^﻿/, ""));
  } catch {
    refuse("The OpenStreetMap supplement is not valid JSON.");
  }
  if (!Array.isArray(input.layers) || input.layers.length !== 1)
    refuse("The OpenStreetMap supplement must hold exactly one layer.");
  const [layer] = input.layers;
  if (layer.id !== SUPPLEMENT_LAYER_ID)
    refuse(`The supplement layer is ${layer.id}, not ${SUPPLEMENT_LAYER_ID}.`);
  const seen = new Set();
  const features = [];
  for (const feature of layer.features ?? []) {
    const entry = ways.get(feature.id);
    if (!entry) refuse(`${feature.id} is not in the reviewed manifest.`);
    if (seen.has(feature.id)) refuse(`${feature.id} appears twice.`);
    seen.add(feature.id);
    const provenance = feature.provenance ?? {};
    if (
      provenance.wayId !== entry.wayId ||
      provenance.version !== entry.version
    )
      refuse(`${feature.id} changed version or way; review it first.`);
    if (feature.status !== "Existing")
      refuse(`${feature.id} is not an existing path.`);
    if (
      JSON.stringify(feature.routeRoles) !== JSON.stringify([entry.routeRole])
    )
      refuse(`${feature.id} has different routing roles than reviewed.`);
    const tags = provenance.sourceTags ?? {};
    for (const [key, value] of Object.entries(entry.requiredTags ?? {}))
      if (tags[key] !== value)
        refuse(`${feature.id} changed its reviewed ${key} tag.`);
    for (const key of ["access", "vehicle", "bicycle"])
      if (
        [
          "no",
          "private",
          "customers",
          "destination",
          "use_sidepath",
          "dismount",
        ].includes(tags[key])
      )
        refuse(`${feature.id} restricts bicycle access.`);
    if (
      tags.highway !== "path" ||
      ["construction", "proposed", "disused", "abandoned"].some(
        (k) => k in tags,
      )
    )
      refuse(`${feature.id} is not a reviewed existing path.`);
    if (
      !Array.isArray(feature.paths) ||
      feature.paths.length !== 1 ||
      feature.paths[0].length < 2 ||
      !feature.paths[0].every(finitePoint)
    )
      refuse(`${feature.id} has invalid geometry.`);
    // Recomputed from the geometry in hand: a copied label proves nothing.
    if (geometryHash(feature.paths[0]) !== entry.geometrySha256)
      refuse(`${feature.id} geometry differs from what was reviewed.`);
    if (provenance.geometrySha256 !== entry.geometrySha256)
      refuse(
        `${feature.id} states a geometry hash that is not the reviewed one.`,
      );
    if (
      provenance.license !== ODBL ||
      provenance.attribution !== ATTRIBUTION ||
      !String(provenance.licenseUrl ?? "").startsWith(
        "https://www.openstreetmap.org/copyright",
      )
    )
      refuse(`${feature.id} does not carry the ODbL notice.`);
    features.push({
      id: feature.id,
      name: feature.name ?? null,
      status: "Existing",
      routeRoles: [entry.routeRole],
      facilityType: feature.facilityType ?? null,
      comfort: feature.comfort ?? null,
      surfaceType: feature.surfaceType ?? null,
      enabledByDefault: feature.enabledByDefault !== false,
      paths: feature.paths,
      provenance: {
        source: "OpenStreetMap",
        sourceUrl: `https://www.openstreetmap.org/way/${entry.wayId}`,
        wayId: entry.wayId,
        version: entry.version,
        geometrySha256: entry.geometrySha256,
        sourceTags: tags,
        reviewedOn: manifest.reviewedOn,
        bicycleEvidence: entry.bicycleEvidence,
        attribution: ATTRIBUTION,
        license: ODBL,
        licenseUrl: manifest.licenseUrl,
      },
    });
  }
  if (seen.size !== ways.size || [...ways.keys()].some((id) => !seen.has(id)))
    refuse("The supplement is not exactly the reviewed set of ways.");
  features.sort((a, b) => a.id.localeCompare(b.id));
  return {
    layer: {
      id: SUPPLEMENT_LAYER_ID,
      name: "Reviewed OpenStreetMap paths",
      features,
    },
    facts: {
      id: SUPPLEMENT_KIND,
      layerId: SUPPLEMENT_LAYER_ID,
      featureCount: features.length,
      wayIds: features.map((f) => f.provenance.wayId),
      reviewedOn: manifest.reviewedOn,
      license: ODBL,
      licenseUrl: manifest.licenseUrl,
      attribution: ATTRIBUTION,
      excludedUntilVerified: excluded,
    },
  };
}

/** The same checks applied to the layer inside a PACKAGED network (used by the build and the release audit). */
export function checkSupplementLayer(layer, record, manifest, manifestBytes) {
  const parts = (record.supplements ?? []).filter(
    (p) => p.id === SUPPLEMENT_KIND,
  );
  // One layer, one descriptor: authenticating the first of several would leave the rest unchecked.
  if ((record.supplements ?? []).length !== 1 || parts.length !== 1)
    refuse(
      "The record must carry exactly one description of the OpenStreetMap supplement.",
    );
  const [part] = parts;
  if (!part)
    refuse(
      "The network has an OpenStreetMap layer the record does not describe.",
    );
  if (
    part.manifestSha256 !== sha256Text(manifestBytes.toString("utf8")) &&
    part.manifestSha256 !==
      createHash("sha256").update(manifestBytes).digest("hex")
  )
    refuse(
      "The supplement was made from a different reviewed manifest than the one committed.",
    );
  const { layer: expected, facts } = admitSupplement(
    JSON.stringify({ layers: [layer] }),
    manifest,
  );
  // Every claim the record copies (layer id, count, ways, review date, licence, licence URL, attribution, exclusions) must
  // be what the reviewed manifest and the layer itself say; only the manifest hash is the record's own.
  const { manifestSha256: _own, ...claimed } = part;
  if (stable(claimed) !== stable(facts))
    refuse(
      "The record's description of the OpenStreetMap supplement is wrong.",
    );
  if (JSON.stringify(layer) !== JSON.stringify(expected))
    refuse(
      "The packaged OpenStreetMap layer is not the verified, allow-listed form.",
    );
  return facts;
}
