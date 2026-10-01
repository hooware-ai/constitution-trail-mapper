// Content helpers and the validation done at every boundary of the coordinator: what a rider asks to save, what the
// transport returns, and what storage hands back. Everything is checked with the #77 contract validators; anything that
// is not fully understood is refused whole.
import {
  CloudRecordError,
  PLACE_SCHEMA,
  ROUTE_SCHEMA,
  engineMatchesRecord,
  instantNanos,
  parsePlaceRecord,
  parseRouteRecord,
  requireOwner,
  type RouteRecord,
} from "../contract";
import type {
  CloudRecord,
  Collection,
  PlaceContent,
  RecordContent,
  RecordKey,
  RouteContent,
} from "./types";

const EPOCH = "1970-01-01T00:00:00Z";
const META_KEYS = ["createdAt", "updatedAt", "revision"];

export const recordKey = (collection: Collection, id: string) =>
  `${collection}/${id}`;
export const keyOfRecord = (key: RecordKey) =>
  recordKey(key.collection, key.id);

export function collectionOfSchema(schema: unknown): Collection | null {
  return schema === ROUTE_SCHEMA
    ? "routes"
    : schema === PLACE_SCHEMA
      ? "places"
      : null;
}
export const collectionOfRecord = (record: CloudRecord): Collection =>
  record.schema === ROUTE_SCHEMA ? "routes" : "places";

/** A record without the cloud's bookkeeping: exactly what a rider chose to save. */
export function contentOf(record: CloudRecord): RecordContent {
  const { createdAt: _c, updatedAt: _u, revision: _r, ...rest } = record;
  return rest as RouteContent | PlaceContent;
}

/** JSON with sorted keys, so two spellings of one value compare equal. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as object)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const sameContent = (a: unknown, b: unknown) =>
  canonicalJson(a) === canonicalJson(b);

/** Two timestamps name the same instant (any spelling, any zone offset). */
export function sameInstant(a: string, b: string): boolean {
  try {
    return instantNanos(a) === instantNanos(b);
  } catch {
    return a === b;
  }
}
/** Negative, zero or positive like a comparator; unparseable timestamps compare as equal only when identical. */
export function compareInstants(a: string, b: string): number {
  try {
    const left = instantNanos(a);
    const right = instantNanos(b);
    return left < right ? -1 : left > right ? 1 : 0;
  } catch {
    return a === b ? 0 : NaN;
  }
}

export type Checked<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; detail: string };

const errorCode = (error: unknown) =>
  error instanceof CloudRecordError
    ? { code: error.code, detail: error.message }
    : { code: "malformed", detail: "is not a record this build understands" };

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * A record that came from the cloud or from storage: it must parse under the contract and belong to `uid`. Its
 * collection is the one it was read from, so a place cannot arrive as a route.
 */
export function readRecord(
  collection: Collection,
  raw: unknown,
  uid: string,
): Checked<CloudRecord> {
  try {
    const record =
      collection === "routes" ? parseRouteRecord(raw) : parsePlaceRecord(raw);
    requireOwner(record, uid);
    return { ok: true, value: record };
  } catch (error) {
    return { ok: false, ...errorCode(error) };
  }
}

/**
 * What a rider asks to save, checked before anything is stored or sent: the shape (the contract's parser, with
 * placeholder bookkeeping), the owner (it must be the signed-in account, never someone else's), and, when there is one,
 * that the engine payload describes the same route. Rejected content never reaches the journal.
 */
export async function checkContent(
  raw: unknown,
  uid: string,
  options: { engine?: boolean } = {},
): Promise<Checked<{ collection: Collection; content: RecordContent }>> {
  if (!isObject(raw))
    return { ok: false, code: "malformed", detail: "content is not an object" };
  const collection = collectionOfSchema(raw.schema);
  if (!collection)
    return {
      ok: false,
      code: "malformed",
      detail: "schema is not a saved route or place",
    };
  for (const key of META_KEYS)
    if (key in raw)
      return {
        ok: false,
        code: "unknown-field",
        detail: `${key} belongs to the cloud and cannot be chosen`,
      };
  const candidate = {
    ...raw,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    revision: 1,
  };
  const read = readRecord(collection, candidate, uid);
  if (!read.ok) return read;
  if (collection === "routes" && options.engine !== false) {
    const route = read.value as RouteRecord;
    if (route.engine !== undefined) {
      try {
        await engineMatchesRecord(route);
      } catch (error) {
        return { ok: false, ...errorCode(error) };
      }
    }
  }
  return {
    ok: true,
    value: { collection, content: contentOf(read.value) },
  };
}
