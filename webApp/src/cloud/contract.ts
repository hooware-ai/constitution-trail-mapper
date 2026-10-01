// Versioned, platform-neutral contract for the records a signed-in rider intentionally saves: routes and places.
//
// This module is the TypeScript boundary: it builds records, validates them before they are written or used, and
// refuses anything it does not fully understand. `cloud/firestore.rules` enforces the same limits independently of any
// client; tests/unit/cloud-rules-agreement.test.ts keeps the two in step. Nothing here talks to a network, reads an
// account, or touches the browser's local library: it is data in, data out.
//
// Not in any cloud record, by design: recents, planner drafts, search text, the active ride, completed-ride history,
// live GPS, the county trail graph or any dataset content.
import {
  POLYLINE_PRECISION_DEGREES,
  decodePath,
  encodePath,
  type LatLon,
} from "./polyline";

export const ROUTE_SCHEMA = "trail-mapper.saved-route";
export const PLACE_SCHEMA = "trail-mapper.saved-place";
/** Versions this build reads and writes. Anything else is refused whole, never partly understood. */
export const SUPPORTED_VERSIONS: readonly number[] = [1];
export const CURRENT_VERSION = 1;
export const ENGINE_CODEC = "gzip-json/1";
/** `fixture` is synthetic review data; `county` is the packaged county dataset. Private local-review data never uploads. */
export const DATASET_KINDS = ["fixture", "county"] as const;
export const ROUTE_KINDS = ["Navigation", "ExerciseLoop"] as const;

/**
 * Every bound a record must respect. Firestore documents are capped at 1 MiB, so geometry plus the compressed engine
 * route are budgeted to about 880 KB together and everything else to a few KB. docs/web/cloud-library-contract.md
 * shows the measured route sizes behind these numbers.
 */
export const LIMITS = {
  idMin: 16,
  idMax: 64,
  titleMax: 120,
  labelMax: 120,
  addressMax: 200,
  datasetIdMax: 100,
  datasetVersionMax: 100,
  geometryChars: 240_000,
  pointCountMax: 40_000,
  pathCountMax: 1_024,
  engineBytes: 640_000,
  /** Cap on the decompressed engine JSON: a small compressed payload must not expand without bound. */
  engineJsonBytes: 12 * 1024 * 1024,
  lengthMetersMax: 400_000,
  milesMin: 0.5,
  milesMax: 100,
  /** A list read is always bounded; clients page with at most this many records. */
  listLimitMax: 200,
} as const;

export const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
export const ROUTE_KEY_PATTERN = /^route-[0-9a-f]{16}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export type CloudErrorCode =
  | "malformed"
  | "unsupported-version"
  | "unknown-field"
  | "missing-field"
  | "invalid-field"
  | "coordinate-out-of-range"
  | "geometry-mismatch"
  | "payload-too-large"
  | "dataset-not-allowed"
  | "owner-mismatch";

/** A record that cannot be trusted. `path` names the field; the message is for developers, never shown as route text. */
export class CloudRecordError extends Error {
  constructor(
    readonly code: CloudErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "CloudRecordError";
  }
}
const fail = (code: CloudErrorCode, path: string, message: string): never => {
  throw new CloudRecordError(code, path, message);
};

export interface CloudEndpoint extends LatLon {
  label: string;
  address?: string;
}
export interface CloudDraft {
  mode: "point" | "loop";
  start: CloudEndpoint;
  destination: CloudEndpoint | null;
  miles: number | null;
  /** The planner's proposed-trails opt-in at the time of saving. */
  proposed: boolean;
}
export interface CloudDatasetIdentity {
  kind: (typeof DATASET_KINDS)[number];
  id: string;
  version: string;
  contentSha256: string;
}
export interface CloudBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

/** Everything a client chooses when it saves a route; timestamps and revision belong to the write. */
export interface RouteFields {
  schema: typeof ROUTE_SCHEMA;
  version: number;
  id: string;
  ownerUid: string;
  /** Hash of the route's own geometry (the local library's key); changes when the route is recalculated. */
  routeKey: string;
  title: string;
  kind: (typeof ROUTE_KINDS)[number];
  draft: CloudDraft;
  lengthMeters: number;
  bounds: CloudBounds;
  /** "T:<polyline>;A:<polyline>;t:..." (see encodeGeometry). Display geometry, latitude first, 1e-7 degrees. */
  geometry: string;
  pointCount: number;
  dataset: CloudDatasetIdentity;
  engineCodec?: typeof ENGINE_CODEC;
  /** The engine's own serialized route, gzip-compressed JSON: what revalidation needs. Optional; see the doc. */
  engine?: Uint8Array;
}
/** The interchange form: what fixtures, other platforms and the validators below exchange. */
export interface RouteRecord extends Omit<RouteFields, "engine"> {
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Base64 of the compressed engine route. */
  engine?: string;
}
export interface PlaceFields {
  schema: typeof PLACE_SCHEMA;
  version: number;
  id: string;
  ownerUid: string;
  label: string;
  address?: string;
  latitude: number;
  longitude: number;
}
export interface PlaceRecord extends PlaceFields {
  createdAt: string;
  updatedAt: string;
  revision: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// primitives

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
) {
  for (const key of required)
    if (!(key in value)) fail("missing-field", `${path}${key}`, "is required");
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      fail("unknown-field", `${path}${key}`, "is not part of this version");
}
/** Single-line text with no leading or trailing space. The same pattern is in firestore.rules (isText). */
export const TEXT_PATTERN = /^[^ \t\r\n\f]([^\r\n]*[^ \t\r\n\f])?$/;
function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string")
    return fail("invalid-field", path, "must be text");
  if (value.length < 1 || value.length > max || !TEXT_PATTERN.test(value))
    return fail(
      "invalid-field",
      path,
      `must be 1-${max} characters on one line without edge spaces`,
    );
  return value;
}
function latitude(value: unknown, path: string): number {
  if (!isFiniteNumber(value))
    return fail("invalid-field", path, "must be a number");
  if (value < -90 || value > 90)
    return fail("coordinate-out-of-range", path, "is outside -90..90");
  return value;
}
function longitude(value: unknown, path: string): number {
  if (!isFiniteNumber(value))
    return fail("invalid-field", path, "must be a number");
  if (value < -180 || value > 180)
    return fail("coordinate-out-of-range", path, "is outside -180..180");
  return value;
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    return fail("malformed", "version", "must be an integer");
  if (!SUPPORTED_VERSIONS.includes(value))
    return fail("unsupported-version", "version", `${value} is not supported`);
  return value;
}
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;
/** A real calendar instant in RFC 3339 form (date, time and offset all present and in range). */
function timestamp(value: unknown, path: string): string {
  const match = typeof value === "string" ? RFC3339.exec(value) : null;
  if (!match)
    return fail("invalid-field", path, "must be an RFC 3339 timestamp");
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  )
    return fail("invalid-field", path, "is not a valid calendar date and time");
  return value as string;
}
/** createdAt and updatedAt: each valid, and the record is never updated before it was created. */
function timestampPair(created: unknown, updated: unknown) {
  const createdAt = timestamp(created, "createdAt");
  const updatedAt = timestamp(updated, "updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt))
    fail("invalid-field", "updatedAt", "is earlier than createdAt");
  return { createdAt, updatedAt };
}
function id(value: unknown, path: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value))
    return fail("invalid-field", path, "must be 16-64 letters, digits, - or _");
  return value;
}

// ---------------------------------------------------------------------------------------------------------------------
// geometry

export interface RouteSegmentLike {
  type: string;
  points: readonly LatLon[];
  isRouted?: boolean;
}

/** One path per drawable segment: `T`/`A` (Trail/Access), lower case when the segment is estimated, not routed. */
export function encodeGeometry(segments: readonly RouteSegmentLike[]): {
  geometry: string;
  pointCount: number;
  bounds: CloudBounds;
} {
  let pointCount = 0,
    south = Infinity,
    north = -Infinity,
    west = Infinity,
    east = -Infinity;
  const paths: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.type !== "Trail" && segment.type !== "Access")
      fail(
        "invalid-field",
        `segments[${index}].type`,
        "is not Trail or Access",
      );
    if (segment.points.length < 2)
      fail(
        "geometry-mismatch",
        `segments[${index}]`,
        "has fewer than two points",
      );
    for (const point of segment.points) {
      latitude(point.latitude, `segments[${index}].latitude`);
      longitude(point.longitude, `segments[${index}].longitude`);
      south = Math.min(south, point.latitude);
      north = Math.max(north, point.latitude);
      west = Math.min(west, point.longitude);
      east = Math.max(east, point.longitude);
    }
    pointCount += segment.points.length;
    const code = segment.type === "Trail" ? "T" : "A";
    paths.push(
      `${segment.isRouted === false ? code.toLowerCase() : code}:${encodePath(segment.points)}`,
    );
  }
  if (!paths.length) fail("geometry-mismatch", "geometry", "has no segments");
  const geometry = paths.join(";");
  if (
    geometry.length > LIMITS.geometryChars ||
    pointCount > LIMITS.pointCountMax ||
    paths.length > LIMITS.pathCountMax
  )
    fail(
      "payload-too-large",
      "geometry",
      "is larger than a saved route may be",
    );
  // Quantisation rounds each coordinate by up to half the precision: widen the box so decoded points stay inside it.
  const pad = POLYLINE_PRECISION_DEGREES * 2;
  return {
    geometry,
    pointCount,
    bounds: {
      south: Math.max(-90, south - pad),
      north: Math.min(90, north + pad),
      west: Math.max(-180, west - pad),
      east: Math.min(180, east + pad),
    },
  };
}

export interface DecodedPath {
  type: "Trail" | "Access";
  isRouted: boolean;
  points: LatLon[];
}
/** Decodes and fully validates a geometry string against the record's declared point count and bounds. */
export function decodeGeometry(
  geometry: string,
  pointCount: number,
  bounds: CloudBounds,
): DecodedPath[] {
  if (geometry.length > LIMITS.geometryChars)
    fail(
      "payload-too-large",
      "geometry",
      "is larger than a saved route may be",
    );
  const parts = geometry.split(";");
  if (parts.length > LIMITS.pathCountMax)
    fail("payload-too-large", "geometry", "has too many paths");
  let total = 0;
  const paths = parts.map((part, index): DecodedPath => {
    const code = part.slice(0, 2);
    if (!/^[TAta]:$/.test(code))
      return fail(
        "geometry-mismatch",
        `geometry[${index}]`,
        "has no path type",
      );
    let points: LatLon[];
    try {
      points = decodePath(part.slice(2));
    } catch (error) {
      return fail(
        "geometry-mismatch",
        `geometry[${index}]`,
        (error as Error).message,
      );
    }
    if (points.length < 2)
      fail(
        "geometry-mismatch",
        `geometry[${index}]`,
        "has fewer than two points",
      );
    for (const point of points) {
      latitude(point.latitude, `geometry[${index}].latitude`);
      longitude(point.longitude, `geometry[${index}].longitude`);
      if (
        point.latitude < bounds.south ||
        point.latitude > bounds.north ||
        point.longitude < bounds.west ||
        point.longitude > bounds.east
      )
        fail(
          "coordinate-out-of-range",
          `geometry[${index}]`,
          "leaves the declared bounds",
        );
    }
    total += points.length;
    return {
      type: code[0].toUpperCase() === "T" ? "Trail" : "Access",
      isRouted: code[0] === code[0].toUpperCase(),
      points,
    };
  });
  if (total !== pointCount)
    fail(
      "geometry-mismatch",
      "pointCount",
      `says ${pointCount} but the geometry holds ${total}`,
    );
  return paths;
}

// ---------------------------------------------------------------------------------------------------------------------
// engine payload

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = (value: string, path: string): Uint8Array => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    return fail("invalid-field", path, "is not base64");
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit: number,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const written = writer
    .write(new Uint8Array(bytes))
    .then(() => writer.close());
  // If reading stops early (a size limit), the pending write rejects; the read has already reported why.
  written.catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        fail(
          "payload-too-large",
          "engine",
          "expands beyond the supported size",
        );
      }
      chunks.push(value);
    }
    await written;
  } catch (error) {
    if (error instanceof CloudRecordError) throw error;
    return fail("invalid-field", "engine", "is not valid compressed data");
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Compresses the engine's serialized route. Fails clearly, before anything is written, if it is too large. */
export async function encodeEngine(route: unknown): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(route));
  if (json.length > LIMITS.engineJsonBytes)
    fail("payload-too-large", "engine", "is larger than a saved route may be");
  const packed = await pipe(
    json,
    new CompressionStream("gzip"),
    LIMITS.engineBytes + 1,
  );
  // The gzip header's OS byte differs by platform (Windows vs Linux): mark it "unknown" so the same route always
  // compresses to the same header. Decoders ignore the byte.
  if (packed.length > 9) packed[9] = 255;
  if (packed.length > LIMITS.engineBytes)
    fail("payload-too-large", "engine", "is larger than a saved route may be");
  return packed;
}
export async function decodeEngine(bytes: Uint8Array): Promise<unknown> {
  if (bytes.length > LIMITS.engineBytes)
    fail("payload-too-large", "engine", "is larger than a saved route may be");
  const json = await pipe(
    bytes,
    new DecompressionStream("gzip"),
    LIMITS.engineJsonBytes,
  );
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    return fail("invalid-field", "engine", "does not hold JSON");
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// building

export interface LocalRouteInput {
  /** The local library's stable key for this route's geometry. */
  key: string;
  title: string;
  /** The engine's serialized route (segments, edges, ...). */
  route: unknown;
  draft: {
    mode: "point" | "loop";
    start: CloudEndpoint | null;
    destination: CloudEndpoint | null;
    miles: number | null;
    proposed: boolean;
  };
  dataset: CloudDatasetIdentity;
}

function endpoint(value: unknown, path: string): CloudEndpoint {
  if (!isObject(value)) return fail("invalid-field", path, "must be an object");
  exactKeys(value, ["label", "latitude", "longitude"], ["address"], `${path}.`);
  const out: CloudEndpoint = {
    label: text(value.label, `${path}.label`, LIMITS.labelMax),
    latitude: latitude(value.latitude, `${path}.latitude`),
    longitude: longitude(value.longitude, `${path}.longitude`),
  };
  if (value.address !== undefined)
    out.address = text(value.address, `${path}.address`, LIMITS.addressMax);
  return out;
}
function draft(value: unknown): CloudDraft {
  if (!isObject(value))
    return fail("invalid-field", "draft", "must be an object");
  exactKeys(
    value,
    ["mode", "start", "destination", "miles", "proposed"],
    [],
    "draft.",
  );
  if (value.mode !== "point" && value.mode !== "loop")
    fail("invalid-field", "draft.mode", "must be point or loop");
  if (typeof value.proposed !== "boolean")
    fail("invalid-field", "draft.proposed", "must be true or false");
  const start = endpoint(value.start, "draft.start");
  const destination =
    value.destination === null
      ? null
      : endpoint(value.destination, "draft.destination");
  let miles: number | null = null;
  if (value.miles !== null) {
    if (
      !isFiniteNumber(value.miles) ||
      value.miles < LIMITS.milesMin ||
      value.miles > LIMITS.milesMax
    )
      fail(
        "invalid-field",
        "draft.miles",
        `must be ${LIMITS.milesMin}-${LIMITS.milesMax}`,
      );
    miles = value.miles as number;
  }
  if (value.mode === "point" && (destination === null || miles !== null))
    fail(
      "invalid-field",
      "draft",
      "a point-to-point plan needs a destination and no distance",
    );
  if (value.mode === "loop" && (destination !== null || miles === null))
    fail(
      "invalid-field",
      "draft",
      "a loop plan needs a distance and no destination",
    );
  return {
    mode: value.mode as "point" | "loop",
    start,
    destination,
    miles,
    proposed: value.proposed as boolean,
  };
}
function dataset(value: unknown): CloudDatasetIdentity {
  if (!isObject(value))
    return fail("invalid-field", "dataset", "must be an object");
  exactKeys(value, ["kind", "id", "version", "contentSha256"], [], "dataset.");
  if (!DATASET_KINDS.includes(value.kind as never))
    fail(
      "dataset-not-allowed",
      "dataset.kind",
      "only fixture and county data may be saved to an account; local review data never uploads",
    );
  if (
    typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256)
  )
    fail(
      "invalid-field",
      "dataset.contentSha256",
      "must be a SHA-256 hex digest",
    );
  return {
    kind: value.kind as CloudDatasetIdentity["kind"],
    id: text(value.id, "dataset.id", LIMITS.datasetIdMax),
    version: text(value.version, "dataset.version", LIMITS.datasetVersionMax),
    contentSha256: value.contentSha256 as string,
  };
}

/** A Navigation route is point-to-point and an ExerciseLoop is a loop; any other pairing contradicts itself. */
function kindMatchesDraft(kind: unknown, planned: CloudDraft) {
  if (
    (kind === "Navigation" && planned.mode !== "point") ||
    (kind === "ExerciseLoop" && planned.mode !== "loop")
  )
    fail(
      "invalid-field",
      "kind",
      `${String(kind)} does not match a ${planned.mode} plan`,
    );
}

/** Both ends the rider chose must lie in the route's own box (with a little room), or the record contradicts itself. */
function endpointsInside(planned: CloudDraft, bounds: CloudBounds) {
  for (const [name, point] of [
    ["start", planned.start],
    ["destination", planned.destination],
  ] as const)
    if (
      point &&
      (point.latitude < bounds.south - 0.01 ||
        point.latitude > bounds.north + 0.01 ||
        point.longitude < bounds.west - 0.01 ||
        point.longitude > bounds.east + 0.01)
    )
      fail(
        "geometry-mismatch",
        `draft.${name}`,
        "is far from the route's geometry",
      );
}

/** Builds the fields to write for a route the rider chose to save. Throws CloudRecordError instead of saving partly. */
export async function buildRouteFields(input: {
  id: string;
  ownerUid: string;
  local: LocalRouteInput;
  includeEngine?: boolean;
}): Promise<RouteFields> {
  const route = input.local.route;
  if (!isObject(route) || !Array.isArray(route.segments))
    return fail("malformed", "route", "has no segments");
  const { geometry, pointCount, bounds } = encodeGeometry(
    route.segments as RouteSegmentLike[],
  );
  const kind = route.kind;
  if (!ROUTE_KINDS.includes(kind as never))
    fail("invalid-field", "route.kind", "must be Navigation or ExerciseLoop");
  const lengthMeters = route.totalDistanceMeters;
  if (
    !isFiniteNumber(lengthMeters) ||
    lengthMeters <= 0 ||
    lengthMeters > LIMITS.lengthMetersMax
  )
    fail(
      "payload-too-large",
      "lengthMeters",
      `must be 0-${LIMITS.lengthMetersMax} m`,
    );
  if (!input.local.draft.start)
    fail("missing-field", "draft.start", "is required");
  const fields: RouteFields = {
    schema: ROUTE_SCHEMA,
    version: CURRENT_VERSION,
    id: id(input.id, "id"),
    ownerUid: text(input.ownerUid, "ownerUid", 128),
    routeKey: ((): string => {
      if (!ROUTE_KEY_PATTERN.test(input.local.key))
        fail("invalid-field", "routeKey", "must be route-<16 hex>");
      return input.local.key;
    })(),
    title: text(input.local.title, "title", LIMITS.titleMax),
    kind: kind as RouteFields["kind"],
    draft: draft(input.local.draft),
    lengthMeters: lengthMeters as number,
    bounds,
    geometry,
    pointCount,
    dataset: dataset(input.local.dataset),
  };
  if (input.includeEngine !== false) {
    fields.engineCodec = ENGINE_CODEC;
    fields.engine = await encodeEngine(route);
  }
  kindMatchesDraft(fields.kind, fields.draft);
  endpointsInside(fields.draft, bounds);
  return fields;
}

export function buildPlaceFields(input: {
  id: string;
  ownerUid: string;
  label: string;
  address?: string;
  latitude: number;
  longitude: number;
}): PlaceFields {
  const fields: PlaceFields = {
    schema: PLACE_SCHEMA,
    version: CURRENT_VERSION,
    id: id(input.id, "id"),
    ownerUid: text(input.ownerUid, "ownerUid", 128),
    label: text(input.label, "label", LIMITS.labelMax),
    latitude: latitude(input.latitude, "latitude"),
    longitude: longitude(input.longitude, "longitude"),
  };
  if (input.address !== undefined)
    fields.address = text(input.address, "address", LIMITS.addressMax);
  return fields;
}

// ---------------------------------------------------------------------------------------------------------------------
// parsing (the validators)

/**
 * Validates a route record read from anywhere (a Firestore document converted to the interchange form, a fixture, another
 * platform). Returns it only if every field is understood and consistent; otherwise throws CloudRecordError and the
 * caller treats the record as unavailable: it never partly opens, plans or navigates.
 */
export function parseRouteRecord(value: unknown): RouteRecord {
  if (!isObject(value)) return fail("malformed", "record", "is not an object");
  // The schema and version come first so a newer record is reported as such, not as "unknown field".
  if (value.schema !== ROUTE_SCHEMA)
    fail("malformed", "schema", `must be ${ROUTE_SCHEMA}`);
  const ver = version(value.version);
  exactKeys(
    value,
    [
      "schema",
      "version",
      "id",
      "ownerUid",
      "routeKey",
      "title",
      "kind",
      "draft",
      "lengthMeters",
      "bounds",
      "geometry",
      "pointCount",
      "dataset",
      "createdAt",
      "updatedAt",
      "revision",
    ],
    ["engineCodec", "engine"],
    "",
  );
  if (!ROUTE_KINDS.includes(value.kind as never))
    fail("invalid-field", "kind", "must be Navigation or ExerciseLoop");
  if (
    typeof value.routeKey !== "string" ||
    !ROUTE_KEY_PATTERN.test(value.routeKey)
  )
    fail("invalid-field", "routeKey", "must be route-<16 hex>");
  if (
    !isFiniteNumber(value.lengthMeters) ||
    value.lengthMeters <= 0 ||
    value.lengthMeters > LIMITS.lengthMetersMax
  )
    fail(
      "invalid-field",
      "lengthMeters",
      `must be 0-${LIMITS.lengthMetersMax} m`,
    );
  if (!isObject(value.bounds))
    fail("invalid-field", "bounds", "must be an object");
  const b = value.bounds as Record<string, unknown>;
  exactKeys(b, ["south", "north", "west", "east"], [], "bounds.");
  const bounds: CloudBounds = {
    south: latitude(b.south, "bounds.south"),
    north: latitude(b.north, "bounds.north"),
    west: longitude(b.west, "bounds.west"),
    east: longitude(b.east, "bounds.east"),
  };
  if (bounds.south > bounds.north || bounds.west > bounds.east)
    fail("invalid-field", "bounds", "is inverted");
  if (typeof value.geometry !== "string")
    fail("invalid-field", "geometry", "must be text");
  if (
    typeof value.pointCount !== "number" ||
    !Number.isInteger(value.pointCount) ||
    value.pointCount < 2 ||
    value.pointCount > LIMITS.pointCountMax
  )
    fail("invalid-field", "pointCount", `must be 2-${LIMITS.pointCountMax}`);
  decodeGeometry(value.geometry as string, value.pointCount as number, bounds);
  const parsedDraft = draft(value.draft);
  kindMatchesDraft(value.kind, parsedDraft);
  endpointsInside(parsedDraft, bounds);
  const record: RouteRecord = {
    schema: ROUTE_SCHEMA,
    version: ver,
    id: id(value.id, "id"),
    ownerUid: text(value.ownerUid, "ownerUid", 128),
    routeKey: value.routeKey as string,
    title: text(value.title, "title", LIMITS.titleMax),
    kind: value.kind as RouteRecord["kind"],
    draft: parsedDraft,
    lengthMeters: value.lengthMeters as number,
    bounds,
    geometry: value.geometry as string,
    pointCount: value.pointCount as number,
    dataset: dataset(value.dataset),
    ...timestampPair(value.createdAt, value.updatedAt),
    revision: ((): number => {
      if (
        typeof value.revision !== "number" ||
        !Number.isInteger(value.revision) ||
        value.revision < 1
      )
        fail("invalid-field", "revision", "must be a positive integer");
      return value.revision as number;
    })(),
  };
  if ("engine" in value !== "engineCodec" in value)
    fail("invalid-field", "engine", "and engineCodec must appear together");
  if ("engine" in value) {
    if (value.engineCodec !== ENGINE_CODEC)
      fail("invalid-field", "engineCodec", `must be ${ENGINE_CODEC}`);
    if (typeof value.engine !== "string")
      fail(
        "invalid-field",
        "engine",
        "must be base64 text in the interchange form",
      );
    const bytes = fromBase64(value.engine as string, "engine");
    if (bytes.length > LIMITS.engineBytes)
      fail(
        "payload-too-large",
        "engine",
        "is larger than a saved route may be",
      );
    record.engineCodec = ENGINE_CODEC;
    record.engine = value.engine as string;
  }
  return record;
}

export function parsePlaceRecord(value: unknown): PlaceRecord {
  if (!isObject(value)) return fail("malformed", "record", "is not an object");
  if (value.schema !== PLACE_SCHEMA)
    fail("malformed", "schema", `must be ${PLACE_SCHEMA}`);
  const ver = version(value.version);
  exactKeys(
    value,
    [
      "schema",
      "version",
      "id",
      "ownerUid",
      "label",
      "latitude",
      "longitude",
      "createdAt",
      "updatedAt",
      "revision",
    ],
    ["address"],
    "",
  );
  const record: PlaceRecord = {
    schema: PLACE_SCHEMA,
    version: ver,
    id: id(value.id, "id"),
    ownerUid: text(value.ownerUid, "ownerUid", 128),
    label: text(value.label, "label", LIMITS.labelMax),
    latitude: latitude(value.latitude, "latitude"),
    longitude: longitude(value.longitude, "longitude"),
    ...timestampPair(value.createdAt, value.updatedAt),
    revision: ((): number => {
      if (
        typeof value.revision !== "number" ||
        !Number.isInteger(value.revision) ||
        value.revision < 1
      )
        fail("invalid-field", "revision", "must be a positive integer");
      return value.revision as number;
    })(),
  };
  if (value.address !== undefined)
    record.address = text(value.address, "address", LIMITS.addressMax);
  return record;
}

/** A record read for an account must belong to that account: a mismatch is refused, never shown. */
export function requireOwner<T extends { ownerUid: string }>(
  record: T,
  uid: string,
): T {
  if (record.ownerUid !== uid)
    fail("owner-mismatch", "ownerUid", "does not belong to this account");
  return record;
}

/**
 * The engine route inside a record must describe exactly the geometry the record declares (up to the 1e-7 degree
 * quantisation): a route that was replaced in one place and not the other is refused rather than half-trusted.
 */
/** The parts of an engine route this contract relies on, validated: anything else in the engine's JSON is its own. */
function engineShape(engine: unknown): {
  kind: string;
  totalDistanceMeters: number;
  segments: Array<{ type: string; isRouted: boolean; points: LatLon[] }>;
} {
  if (!isObject(engine))
    return fail("geometry-mismatch", "engine", "is not an object");
  if (!ROUTE_KINDS.includes(engine.kind as never))
    fail(
      "geometry-mismatch",
      "engine.kind",
      "must be Navigation or ExerciseLoop",
    );
  if (
    !isFiniteNumber(engine.totalDistanceMeters) ||
    engine.totalDistanceMeters <= 0 ||
    engine.totalDistanceMeters > LIMITS.lengthMetersMax
  )
    fail(
      "geometry-mismatch",
      "engine.totalDistanceMeters",
      "must be a positive length",
    );
  if (
    !Array.isArray(engine.segments) ||
    engine.segments.length < 1 ||
    engine.segments.length > LIMITS.pathCountMax
  )
    return fail(
      "geometry-mismatch",
      "engine.segments",
      "must be a list of segments",
    );
  const segments = engine.segments.map((segment: unknown, i: number) => {
    const at = `engine.segments[${i}]`;
    if (!isObject(segment))
      return fail("geometry-mismatch", at, "is not an object");
    if (segment.type !== "Trail" && segment.type !== "Access")
      fail("geometry-mismatch", `${at}.type`, "must be Trail or Access");
    if (segment.isRouted !== undefined && typeof segment.isRouted !== "boolean")
      fail("geometry-mismatch", `${at}.isRouted`, "must be true or false");
    if (
      !Array.isArray(segment.points) ||
      segment.points.length < 2 ||
      segment.points.length > LIMITS.pointCountMax
    )
      return fail(
        "geometry-mismatch",
        `${at}.points`,
        "must be a list of at least two points",
      );
    const points = segment.points.map((point: unknown, j: number) => {
      if (!isObject(point))
        return fail(
          "geometry-mismatch",
          `${at}.points[${j}]`,
          "is not an object",
        );
      return {
        latitude: latitude(point.latitude, `${at}.points[${j}].latitude`),
        longitude: longitude(point.longitude, `${at}.points[${j}].longitude`),
      };
    });
    return {
      type: segment.type as string,
      isRouted: segment.isRouted !== false,
      points,
    };
  });
  return {
    kind: engine.kind as string,
    totalDistanceMeters: engine.totalDistanceMeters as number,
    segments,
  };
}

/**
 * The engine route inside a record must describe exactly the record it travels in: its structure is validated
 * (anything missing or not a finite coordinate is refused), its kind and length summary agree with the record, and its
 * geometry equals the declared geometry up to the 1e-7 degree quantisation. A route replaced in one place and not the
 * other is refused rather than half-trusted.
 */
export async function engineMatchesRecord(
  record: RouteRecord,
): Promise<unknown> {
  if (record.engine === undefined)
    return fail("missing-field", "engine", "is not present");
  const engine = await decodeEngine(fromBase64(record.engine, "engine"));
  const shape = engineShape(engine);
  if (shape.kind !== record.kind)
    fail("geometry-mismatch", "engine.kind", "differs from the record's kind");
  // Both numbers are the same value written by the builder; any difference means one side was altered.
  if (!(Math.abs(shape.totalDistanceMeters - record.lengthMeters) <= 0.01))
    fail(
      "geometry-mismatch",
      "engine.totalDistanceMeters",
      "differs from the record's length",
    );
  const declared = decodeGeometry(
    record.geometry,
    record.pointCount,
    record.bounds,
  );
  if (shape.segments.length !== declared.length)
    fail("geometry-mismatch", "engine", "has a different number of segments");
  const tolerance = POLYLINE_PRECISION_DEGREES * 2;
  shape.segments.forEach((segment, i) => {
    const want = declared[i];
    if (
      segment.points.length !== want.points.length ||
      segment.type !== want.type ||
      segment.isRouted !== want.isRouted
    )
      fail(
        "geometry-mismatch",
        `engine.segments[${i}]`,
        "differs from the record's geometry",
      );
    segment.points.forEach((point, j) => {
      // Written so a value that is not a number can never pass (a comparison with NaN is false).
      if (
        !(Math.abs(point.latitude - want.points[j].latitude) <= tolerance) ||
        !(Math.abs(point.longitude - want.points[j].longitude) <= tolerance)
      )
        fail(
          "geometry-mismatch",
          `engine.segments[${i}].points[${j}]`,
          "differs from the record's geometry",
        );
    });
  });
  return engine;
}

/** Converts fields (with engine bytes) to the interchange form, given the write's timestamps and revision. */
export function toRouteRecord(
  fields: RouteFields,
  meta: { createdAt: string; updatedAt: string; revision: number },
): RouteRecord {
  const { engine, ...rest } = fields;
  return { ...rest, ...meta, ...(engine ? { engine: toBase64(engine) } : {}) };
}
/** The reverse: interchange form to the fields a Firestore document stores (engine as bytes). */
export function routeFieldsOf(record: RouteRecord): RouteFields {
  const {
    createdAt: _c,
    updatedAt: _u,
    revision: _r,
    engine,
    ...rest
  } = record;
  return {
    ...rest,
    ...(engine ? { engine: fromBase64(engine, "engine") } : {}),
  };
}
