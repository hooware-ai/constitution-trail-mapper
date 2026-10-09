// Admission of the ordinary-road access SOURCE input: which extract is allowed into a package at all.
//
// Four things are kept apart here and everywhere that touches this data:
//   1. INTEGRITY    - the package parts hash to what the record says (access-package.mjs, dataset-package.mjs).
//   2. SOURCE REVIEW - this file: the input extract is the exact reviewed one (a pinned SHA-256 and its recorded source
//                      metadata), not "any well-formed road JSON". A future, updated extract is a different hash and
//                      needs a fresh review entry before it can be packaged.
//   3. OWNER COMPOSITION APPROVAL - a committed, explicit expected composition (composition.mjs).
//   4. PUBLICATION / RIGHTS APPROVAL - the approval flags and blockers; nothing here grants or implies either.
// A matching hash proves WHICH bytes were reviewed. It is not legal permission and not a publication approval.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { repoRoot } from "./core.mjs";
import { LOCAL_LAYER_ID } from "./access-package.mjs";
import { manifestDigest } from "./composition.mjs";

export const ACCESS_MANIFEST_KIND = "access-road-source";
export const committedAccessManifestFile = join(
  repoRoot,
  "data",
  "web-access-roads.manifest.json",
);

export class AccessSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "AccessSourceError";
  }
}
const refuse = (message) => {
  throw new AccessSourceError(message);
};
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const HEX = /^[0-9a-f]{64}$/;

/** The reviewed-source manifest, checked for shape. `manifestBytes` is hashed by the caller into the record. */
export function parseAccessManifest(manifestBytes) {
  let manifest;
  try {
    manifest = JSON.parse(
      Buffer.from(manifestBytes).toString("utf8").replace(/^﻿/, ""),
    );
  } catch {
    refuse("The access source manifest is not valid JSON.");
  }
  if (manifest?.schemaVersion !== 1 || manifest.kind !== ACCESS_MANIFEST_KIND)
    refuse("The access source manifest is not of the supported kind.");
  if (!HEX.test(manifest.sourceInputSha256 ?? ""))
    refuse("The access source manifest pins no source input SHA-256.");
  const counts = manifest.sourceInput?.layerCounts;
  if (
    !counts ||
    typeof counts !== "object" ||
    !Object.values(counts).every((n) => Number.isInteger(n) && n > 0) ||
    !Number.isInteger(counts[LOCAL_LAYER_ID])
  )
    refuse("The access source manifest records no per-layer feature counts.");
  const transform = manifest.expectedTransform;
  if (
    !transform ||
    !HEX.test(transform.baseSha256 ?? "") ||
    !HEX.test(transform.indexSha256 ?? "") ||
    !Number.isInteger(transform.tileCount) ||
    !Number.isInteger(transform.tileAssignments)
  )
    refuse(
      "The access source manifest pins no expected transform digests (normalized base roads and tile index).",
    );
  if (typeof manifest.testOnly !== "boolean")
    refuse("The access source manifest does not say whether it is test-only.");
  return manifest;
}

/**
 * Only the pinned extract is admitted: its exact bytes, and the layer counts the review recorded. Anything else (a
 * re-run extractor, a hand-edited file, a different county) is refused until it has its own review entry.
 */
export function admitAccessSource(inputText, manifestBytes) {
  const manifest = parseAccessManifest(manifestBytes);
  const inputSha256 = sha256(Buffer.from(inputText, "utf8"));
  if (inputSha256 !== manifest.sourceInputSha256)
    refuse(
      `The access road extract (${inputSha256.slice(0, 12)}) is not the reviewed source input (${manifest.sourceInputSha256.slice(0, 12)}). A new or changed extract needs a fresh source review identity in the access source manifest; a well-formed file is not enough.`,
    );
  const input = JSON.parse(inputText.replace(/^﻿/, ""));
  const counts = {};
  for (const layer of input.layers ?? [])
    counts[layer.id] = (counts[layer.id] ?? 0) + (layer.features?.length ?? 0);
  const expected = manifest.sourceInput.layerCounts;
  const same =
    Object.keys(counts).length === Object.keys(expected).length &&
    Object.entries(expected).every(([id, n]) => counts[id] === n);
  if (!same)
    refuse("The access road extract's layers differ from the reviewed counts.");
  return {
    manifest,
    source: {
      inputSha256,
      manifestSha256: manifestDigest(manifestBytes),
      testOnly: manifest.testOnly === true,
    },
  };
}

/**
 * The audit's side: a shipped access record must name the committed manifest by hash, the manifest's pinned input,
 * and agree with it about how many roads there are.
 */
export function checkAccessSource(access, manifestBytes) {
  const manifest = parseAccessManifest(manifestBytes);
  const source = access?.source;
  if (!source || typeof source !== "object")
    refuse("The access record names no reviewed source input.");
  if (source.manifestSha256 !== manifestDigest(manifestBytes))
    refuse(
      "The access roads were packaged from a different source manifest than the one given to check.",
    );
  if (source.inputSha256 !== manifest.sourceInputSha256)
    refuse(
      "The access record names a source input the manifest did not review.",
    );
  if ((source.testOnly === true) !== (manifest.testOnly === true))
    refuse("The access record and its manifest disagree about test-only use.");
  const counts = manifest.sourceInput.layerCounts;
  const local = counts[LOCAL_LAYER_ID];
  const base = Object.entries(counts)
    .filter(([id]) => id !== LOCAL_LAYER_ID)
    .reduce((n, [, count]) => n + count, 0);
  if (
    access.base.featureCount !== base ||
    access.index.localFeatureCount !== local
  )
    refuse(
      "The packaged road counts differ from the reviewed source input's counts.",
    );
  checkAccessTransform(access, manifest);
  return manifest;
}

/**
 * The reviewed TRANSFORM, not just the reviewed input: the normalized base roads and the tile index (which pins every
 * tile's bytes, so every service road's identity, geometry and order) must be exactly the digests the manifest derived
 * from the SHA-verified raw input. A package with authentic source labels but replaced content is refused here.
 */
export function checkAccessTransform(access, manifest) {
  const expected = manifest.expectedTransform;
  if (
    access.base.sha256 !== expected.baseSha256 ||
    access.index.sha256 !== expected.indexSha256 ||
    access.index.tileCount !== expected.tileCount ||
    access.index.tileAssignments !== expected.tileAssignments
  )
    refuse(
      "The access roads are not the reviewed transform of the reviewed source input (the normalized base roads or tile index differ from the expected digests).",
    );
}
