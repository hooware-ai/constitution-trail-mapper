// Dataset identity and integrity for the routing network the app loads. Pure functions, shared by the worker and the tests.
//
// Three sources stay distinct: the bundled synthetic fixture, the private local-review files served by the
// development server, and a packaged county candidate that is fetched, verified and only then handed to the router.
// Nothing here ever falls back from one to another: a county build that cannot load its data reports why.

export type DatasetKind = "fixture" | "county";
export type DatasetChannel = "review" | "public";

export const DATASET_RECORD_SCHEMA = "trail-mapper.dataset/1";
export const NETWORK_CONTENT_SCHEMA = "trail-mapper.network/1";

export interface DatasetApproval {
  approved: boolean;
  approvedBy: string | null;
  approvedOn: string | null;
  /** Human-readable reasons this dataset may not be presented as ready; never invented by the packager. */
  blockers: string[];
}
export interface DatasetSource {
  reviewedOn: string;
  /** When the extractor ran; this is NOT when the source was last updated upstream. */
  extractedAtUtc: string;
  evidenceVerifiedAtUtc: string | null;
  manifestSha256: string;
  licensedItemId: string;
  licensedSourceUrl: string;
  license: string;
  licenseUrl: string;
  licenseEvidenceUrl: string;
  licenseEvidenceSha256: string | null;
  attribution: string;
  changes: string;
  disclaimer: string;
}
/** A separately reviewed source packaged as its own layer of the network (today: the reviewed OpenStreetMap paths). */
export interface SupplementPart {
  id: string;
  layerId: string;
  featureCount: number;
  wayIds: number[];
  reviewedOn: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  manifestSha256: string;
  /** What the review keeps OUT (known gaps stay gaps; unverified ways are never imported). */
  excludedUntilVerified: string[];
}
/**
 * Proposed (not yet built) trail segments, packaged only under a granted rights block with evidence. They are their own
 * layer, off unless the rider opts in, and a route using them is a preview that cannot start navigation.
 */
export interface ProposedLayerPart {
  id: string;
  layerId: string;
  featureCount: number;
  segmentIds: string[];
  reviewedOn: string;
  basis: string;
  evidenceUrl: string;
  evidenceSha256: string;
  grantedBy: string;
  grantedOn: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  note: string;
  manifestSha256: string;
}
/** A hash-named file the page may fetch from beside the dataset record: its name, exact size and SHA-256. */
export interface AccessPartRef {
  file: string;
  sha256: string;
  bytes: number;
}
/**
 * Ordinary-road access, split so a trip downloads only what it needs: the base roads load with the data, the
 * endpoint-local service roads load as small tiles around a trip's endpoints (see accessTiles.ts). The record pins
 * every part by hash through the tile index.
 */
export interface AccessDescriptor {
  base: AccessPartRef & { featureCount: number };
  index: AccessPartRef & {
    tileCount: number;
    localFeatureCount: number;
    tileAssignments: number;
    tileBytes: number;
  };
  cellDegrees: number;
  windowCells: number;
  radiusMeters: number;
  /** sha256(network sha256 + ":" + index sha256): the identity a saved route remembers when access is packaged. */
  combinedSha256: string;
}
export interface DatasetRecord {
  schema: typeof DATASET_RECORD_SCHEMA;
  kind: DatasetKind;
  id: string;
  version: string;
  label: string;
  content: {
    file: string;
    schema: typeof NETWORK_CONTENT_SCHEMA;
    sha256: string;
    bytes: number;
    featureCount: number;
    layerCounts: Record<string, number>;
  };
  source: DatasetSource;
  /** Optional reviewed supplements, each its own layer with its own source, licence and attribution. */
  supplements?: SupplementPart[];
  /** Optional rights-gated proposed-trail segments (a separate opt-in layer). */
  proposedLayer?: ProposedLayerPart;
  /** Optional ordinary-road access parts, pinned by hash. */
  access?: AccessDescriptor;
  /** What was deliberately left out and why, shown to riders as coverage limits. */
  omitted: {
    proposedFeatureIds: number[];
    supplements: string;
    accessRoads: string;
  };
  approval: DatasetApproval;
}
/** What travels with a saved route and is echoed by the router: enough to tell which data it was checked against. */
export interface DatasetIdentity {
  kind: DatasetKind;
  id: string;
  version: string;
  contentSha256: string;
}

export type DatasetErrorCode =
  | "data-missing"
  | "data-unavailable"
  | "data-corrupt"
  | "data-incompatible"
  | "data-unapproved";

/** A load failure the rider can act on (retry, check the connection, reload). Never swallowed into a fallback. */
export class DatasetError extends Error {
  constructor(
    readonly code: DatasetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DatasetError";
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const PART_FILE = /^[A-Za-z0-9._-]+$/;
const nonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
function validPart(part: unknown): boolean {
  return (
    isObject(part) &&
    typeof part.file === "string" &&
    PART_FILE.test(part.file) &&
    !part.file.includes("..") &&
    typeof part.sha256 === "string" &&
    SHA256.test(part.sha256) &&
    part.file.includes(part.sha256.slice(0, 12)) &&
    count(part.bytes)
  );
}
function validProposed(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    text(value.id) &&
    text(value.layerId) &&
    count(value.featureCount) &&
    Array.isArray(value.segmentIds) &&
    value.segmentIds.length === value.featureCount &&
    value.segmentIds.every((id) => text(id)) &&
    text(value.reviewedOn) &&
    text(value.basis) &&
    typeof value.evidenceUrl === "string" &&
    /^https:\/\//i.test(value.evidenceUrl) &&
    typeof value.evidenceSha256 === "string" &&
    SHA256.test(value.evidenceSha256) &&
    text(value.grantedBy) &&
    text(value.grantedOn) &&
    text(value.license) &&
    typeof value.licenseUrl === "string" &&
    /^https:\/\//i.test(value.licenseUrl) &&
    text(value.attribution) &&
    text(value.note) &&
    typeof value.manifestSha256 === "string" &&
    SHA256.test(value.manifestSha256)
  );
}
function validAccess(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.base) || !isObject(value.index))
    return false;
  return (
    validPart(value.base) &&
    count(value.base.featureCount) &&
    validPart(value.index) &&
    nonNegative(value.index.tileCount) &&
    nonNegative(value.index.localFeatureCount) &&
    nonNegative(value.index.tileAssignments) &&
    nonNegative(value.index.tileBytes) &&
    value.cellDegrees === 0.01 &&
    value.windowCells === 1 &&
    value.radiusMeters === 600 &&
    typeof value.combinedSha256 === "string" &&
    SHA256.test(value.combinedSha256)
  );
}

export function identityOf(record: DatasetRecord): DatasetIdentity {
  return {
    kind: record.kind,
    id: record.id,
    version: record.version,
    // With access packaged, a saved route is only as good as the roads it was planned on: identity covers both.
    contentSha256: record.access?.combinedSha256 ?? record.content.sha256,
  };
}

/**
 * Validates a fetched dataset record. Throws DatasetError for anything the app does not understand or must not
 * present: an unknown schema, a missing field, or (in the public channel) data that is not approved.
 */
export function parseDatasetRecord(
  value: unknown,
  channel: DatasetChannel,
): DatasetRecord {
  if (!isObject(value))
    throw new DatasetError(
      "data-corrupt",
      "The trail data description is not readable.",
    );
  if (value.schema !== DATASET_RECORD_SCHEMA)
    throw new DatasetError(
      "data-incompatible",
      "This trail data was made for a different version of the app. Reload the page; if it persists the site needs an update.",
    );
  const content = value.content,
    source = value.source,
    approval = value.approval,
    omitted = value.omitted;
  if (
    value.kind !== "county" ||
    !text(value.id) ||
    !text(value.version) ||
    !text(value.label) ||
    !isObject(content) ||
    !isObject(source) ||
    !isObject(approval) ||
    !isObject(omitted)
  )
    throw new DatasetError(
      "data-corrupt",
      "The trail data description is incomplete.",
    );
  if (content.schema !== NETWORK_CONTENT_SCHEMA)
    throw new DatasetError(
      "data-incompatible",
      "This trail data uses a format this version of the app cannot read. Reload the page.",
    );
  if (
    typeof content.file !== "string" ||
    !/^trails\.[0-9a-f]{12}\.json$/.test(content.file) ||
    typeof content.sha256 !== "string" ||
    !SHA256.test(content.sha256) ||
    !content.file.includes(content.sha256.slice(0, 12)) ||
    !count(content.bytes) ||
    !count(content.featureCount) ||
    !isObject(content.layerCounts)
  )
    throw new DatasetError(
      "data-corrupt",
      "The trail data description has invalid content details.",
    );
  for (const key of [
    "reviewedOn",
    "extractedAtUtc",
    "manifestSha256",
    "licensedSourceUrl",
    "license",
    "licenseUrl",
    "licenseEvidenceUrl",
    "attribution",
    "changes",
    "disclaimer",
  ] as const)
    if (!text(source[key]))
      throw new DatasetError(
        "data-corrupt",
        `The trail data description lacks ${key}.`,
      );
  // Everything the Trail data section renders is validated here, so a damaged description is a load error with Retry
  // and never a blank screen later.
  if (
    !Array.isArray(omitted.proposedFeatureIds) ||
    !omitted.proposedFeatureIds.every(
      (id) => typeof id === "number" && Number.isInteger(id) && id > 0,
    ) ||
    !text(omitted.supplements) ||
    !text(omitted.accessRoads)
  )
    throw new DatasetError(
      "data-corrupt",
      "The trail data description does not say what it leaves out.",
    );
  if (
    typeof approval.approved !== "boolean" ||
    !Array.isArray(approval.blockers) ||
    !approval.blockers.every((blocker) => text(blocker)) ||
    (approval.approvedBy != null && typeof approval.approvedBy !== "string") ||
    (approval.approvedOn != null && typeof approval.approvedOn !== "string")
  )
    throw new DatasetError(
      "data-corrupt",
      "The trail data approval record is invalid.",
    );
  if (value.proposedLayer !== undefined && !validProposed(value.proposedLayer))
    throw new DatasetError(
      "data-corrupt",
      "The description of the proposed trails is invalid.",
    );
  if (value.access !== undefined && !validAccess(value.access))
    throw new DatasetError(
      "data-corrupt",
      "The description of the road access data is invalid.",
    );
  if (value.supplements !== undefined) {
    const parts = value.supplements;
    const valid =
      Array.isArray(parts) &&
      // At most one description: the one supported OpenStreetMap layer has one, and the Data and credits screens add
      // up every description they are given.
      parts.length <= 1 &&
      parts.every(
        (part) =>
          isObject(part) &&
          text(part.id) &&
          text(part.layerId) &&
          count(part.featureCount) &&
          Array.isArray(part.wayIds) &&
          part.wayIds.every((id) => count(id)) &&
          text(part.reviewedOn) &&
          text(part.license) &&
          text(part.licenseUrl) &&
          text(part.attribution) &&
          typeof part.manifestSha256 === "string" &&
          SHA256.test(part.manifestSha256) &&
          Array.isArray(part.excludedUntilVerified) &&
          part.excludedUntilVerified.every((entry) => text(entry)),
      );
    if (!valid)
      throw new DatasetError(
        "data-corrupt",
        "The description of the reviewed supplement is invalid.",
      );
  }
  if (
    approval.approved === true &&
    !(text(approval.approvedBy) && text(approval.approvedOn))
  )
    throw new DatasetError(
      "data-corrupt",
      "The trail data claims approval without saying who approved it and when.",
    );
  if (channel === "public" && approval.approved !== true)
    throw new DatasetError(
      "data-unapproved",
      "This trail data has not been approved for public use, so it will not be shown.",
    );
  return value as unknown as DatasetRecord;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new DatasetError(
      "data-unavailable",
      "Trail data can only be verified on a secure (HTTPS) connection.",
    );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verifies the downloaded network file against the record: length, hash, format and feature count. */
export async function verifyDatasetContent(
  bytes: ArrayBuffer,
  record: DatasetRecord,
): Promise<string> {
  if (bytes.byteLength !== record.content.bytes)
    throw new DatasetError(
      "data-corrupt",
      "The downloaded trail data is incomplete or damaged. Check your connection and retry.",
    );
  if ((await sha256Hex(bytes)) !== record.content.sha256)
    throw new DatasetError(
      "data-corrupt",
      "The downloaded trail data does not match its recorded checksum. Retry; if it persists the site needs attention.",
    );
  const textContent = new TextDecoder("utf-8").decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(textContent.replace(/^﻿/, ""));
  } catch {
    throw new DatasetError(
      "data-corrupt",
      "The downloaded trail data is not valid.",
    );
  }
  const layers = isObject(parsed) ? parsed.layers : undefined;
  const features = Array.isArray(layers)
    ? layers.flatMap((layer) =>
        isObject(layer) && Array.isArray(layer.features) ? layer.features : [],
      )
    : [];
  if (features.length !== record.content.featureCount)
    throw new DatasetError(
      "data-corrupt",
      "The trail data has a different number of trails than its record says.",
    );
  return textContent;
}
