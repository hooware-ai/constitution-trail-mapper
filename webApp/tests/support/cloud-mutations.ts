// One table of ways a route or place record can be wrong, shared by the validator tests and the emulator rules tests so
// the two are held to the same list. `ts` is the CloudRecordError code the validators must throw ("ok" if they accept);
// `rules` is what firestore.rules must do with the same record on create ("na" where the rule cannot see the field).
import type { CloudErrorCode } from "../../src/cloud/contract";
import { ROUTE_ID } from "./cloud-fixtures";

type Doc = Record<string, any>;
export interface Mutation {
  name: string;
  change: (record: Doc) => void;
  ts: CloudErrorCode | "ok";
  rules: "allow" | "deny" | "na";
  /** Documented limit of a rule that cannot loop or compare fields: the validators catch it, the rules do not. */
  note?: string;
}
const dropKey = (key: string) => (r: Doc) => void delete r[key];

export const ROUTE_MUTATIONS: Mutation[] = [
  { name: "a valid record", change: () => {}, ts: "ok", rules: "allow" },
  {
    name: "wrong schema",
    change: (r) => (r.schema = "other"),
    ts: "malformed",
    rules: "deny",
  },
  {
    name: "a newer version",
    change: (r) => (r.version = 2),
    ts: "unsupported-version",
    rules: "deny",
  },
  {
    name: "version as text",
    change: (r) => (r.version = "1"),
    ts: "malformed",
    rules: "deny",
  },
  {
    name: "an unknown field",
    change: (r) => (r.extra = true),
    ts: "unknown-field",
    rules: "deny",
  },
  {
    name: "an unknown nested field",
    change: (r) => (r.draft.start.nickname = "x"),
    ts: "unknown-field",
    rules: "deny",
  },
  {
    name: "a missing title",
    change: dropKey("title"),
    ts: "missing-field",
    rules: "deny",
  },
  {
    name: "an empty title",
    change: (r) => (r.title = ""),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a title of 121 characters",
    change: (r) => (r.title = "t".repeat(121)),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a title of 120 characters",
    change: (r) => (r.title = "t".repeat(120)),
    ts: "ok",
    rules: "allow",
  },
  {
    name: "a title with a leading space",
    change: (r) => (r.title = " lead"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a title with a line break",
    change: (r) => (r.title = "two\nlines"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a title that is a number",
    change: (r) => (r.title = 5),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "an id that is too short",
    change: (r) => (r.id = "short"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "an id with a slash",
    change: (r) => (r.id = "a/b" + "c".repeat(20)),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "an owner that is not the signed-in account",
    change: (r) => (r.ownerUid = "mallory"),
    ts: "ok",
    rules: "deny",
    note: "ownership is the account's business: requireOwner checks it where the account is known",
  },
  {
    name: "a bad route key",
    change: (r) => (r.routeKey = "route-xyz"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "an unknown route kind",
    change: (r) => (r.kind = "Bike"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a planner mode that does not exist",
    change: (r) => (r.draft.mode = "walk"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a point-to-point plan with no destination",
    change: (r) => (r.draft.destination = null),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a point-to-point plan that also carries a distance",
    change: (r) => (r.draft.miles = 3),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "the proposed choice as text",
    change: (r) => (r.draft.proposed = "yes"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a start latitude of 91",
    change: (r) => (r.draft.start.latitude = 91),
    ts: "coordinate-out-of-range",
    rules: "deny",
  },
  {
    name: "a start longitude of -181",
    change: (r) => (r.draft.start.longitude = -181),
    ts: "coordinate-out-of-range",
    rules: "deny",
  },
  {
    name: "a start latitude as text",
    change: (r) => (r.draft.start.latitude = "40.5"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a start latitude that is NaN",
    change: (r) => (r.draft.start.latitude = Number.NaN),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a destination label that is empty",
    change: (r) => (r.draft.destination.label = ""),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "an inverted bounding box",
    change: (r) =>
      ([r.bounds.south, r.bounds.north] = [r.bounds.north, r.bounds.south]),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a start far outside the geometry's box",
    change: (r) => (r.draft.start.latitude = 41.5),
    ts: "geometry-mismatch",
    rules: "deny",
  },
  {
    name: "an empty geometry",
    change: (r) => (r.geometry = ""),
    ts: "geometry-mismatch",
    rules: "deny",
  },
  {
    name: "a geometry of 240001 characters",
    change: (r) => (r.geometry = "T:" + "?".repeat(239_999)),
    ts: "payload-too-large",
    rules: "deny",
  },
  {
    name: "a geometry that is not a polyline",
    change: (r) => (r.geometry = "T:" + "!!"),
    ts: "geometry-mismatch",
    rules: "allow",
    note: "the rule bounds the size only; points are validated by the TypeScript validators",
  },
  {
    name: "a point count that disagrees with the geometry",
    change: (r) => (r.pointCount = r.pointCount + 1),
    ts: "geometry-mismatch",
    rules: "allow",
    note: "a rule cannot decode a polyline to count it",
  },
  {
    name: "a point count of 40001",
    change: (r) => (r.pointCount = 40_001),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a point count that is not a whole number",
    change: (r) => (r.pointCount = 3.5),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a length of zero",
    change: (r) => (r.lengthMeters = 0),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a length beyond the supported maximum",
    change: (r) => (r.lengthMeters = 400_001),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "local review data as the dataset",
    change: (r) => (r.dataset.kind = "local"),
    ts: "dataset-not-allowed",
    rules: "deny",
  },
  {
    name: "a dataset digest that is not SHA-256",
    change: (r) => (r.dataset.contentSha256 = "abc"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "an unknown dataset field",
    change: (r) => (r.dataset.graph = {}),
    ts: "unknown-field",
    rules: "deny",
  },
  {
    name: "an engine with no codec",
    change: dropKey("engineCodec"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a codec with no engine",
    change: dropKey("engine"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "an unknown engine codec",
    change: (r) => (r.engineCodec = "zip/9"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a record with no engine at all",
    change: (r) => {
      delete r.engine;
      delete r.engineCodec;
    },
    ts: "ok",
    rules: "allow",
    note: "the engine is optional: a consumer without it recalculates from the draft",
  },
  {
    name: "a revision of 0",
    change: (r) => (r.revision = 0),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a first write that claims revision 2",
    change: (r) => (r.revision = 2),
    ts: "ok",
    rules: "deny",
    note: "a create must be revision 1",
  },
  {
    name: "a malformed created time",
    change: (r) => (r.createdAt = "yesterday"),
    ts: "invalid-field",
    rules: "na",
    note: "timestamps are server-assigned in a document",
  },
];

export const PLACE_MUTATIONS: Mutation[] = [
  { name: "a valid place", change: () => {}, ts: "ok", rules: "allow" },
  {
    name: "wrong schema",
    change: (r) => (r.schema = ROUTE_ID),
    ts: "malformed",
    rules: "deny",
  },
  {
    name: "a newer version",
    change: (r) => (r.version = 2),
    ts: "unsupported-version",
    rules: "deny",
  },
  {
    name: "an unknown field",
    change: (r) => (r.notes = "x"),
    ts: "unknown-field",
    rules: "deny",
  },
  {
    name: "a missing label",
    change: dropKey("label"),
    ts: "missing-field",
    rules: "deny",
  },
  {
    name: "an empty label",
    change: (r) => (r.label = ""),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a label of 121 characters",
    change: (r) => (r.label = "l".repeat(121)),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "an address of 201 characters",
    change: (r) => (r.address = "a".repeat(201)),
    ts: "invalid-field",
    rules: "deny",
  },
  { name: "no address", change: dropKey("address"), ts: "ok", rules: "allow" },
  {
    name: "a latitude of 90.0001",
    change: (r) => (r.latitude = 90.0001),
    ts: "coordinate-out-of-range",
    rules: "deny",
  },
  {
    name: "a longitude of 180.0001",
    change: (r) => (r.longitude = 180.0001),
    ts: "coordinate-out-of-range",
    rules: "deny",
  },
  {
    name: "a latitude of exactly 90",
    change: (r) => (r.latitude = 90),
    ts: "ok",
    rules: "allow",
  },
  {
    name: "a latitude as text",
    change: (r) => (r.latitude = "40.5"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "an owner that is not the signed-in account",
    change: (r) => (r.ownerUid = "mallory"),
    ts: "ok",
    rules: "deny",
    note: "ownership is the account's business: requireOwner checks it where the account is known",
  },
  {
    name: "an id that is too short",
    change: (r) => (r.id = "short"),
    ts: "invalid-field",
    rules: "deny",
  },
  {
    name: "a revision of 3 on create",
    change: (r) => (r.revision = 3),
    ts: "ok",
    rules: "deny",
    note: "a create must be revision 1",
  },
];
