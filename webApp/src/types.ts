import type { DatasetIdentity, DatasetRecord } from "./dataset";
export type Point = { latitude: number; longitude: number };
export type Endpoint = Point & { label: string; address?: string };
export type Draft = {
  mode: "point" | "loop";
  start: Endpoint | null;
  destination: Endpoint | null;
  miles: number;
  proposed: boolean;
};
export type Feature = {
  id: string;
  name: string | null;
  status: string;
  roles: string[];
  paths: Point[][];
};
export type Closure = {
  id: string;
  title: string;
  message: string;
  sourceUrl: string;
  locationDescription?: string;
  closedFrom?: Point;
  closedTo?: Point;
  points?: Point[];
  /** The notice's estimated completion (information only: it never reopens anything), and when the closure began. */
  estimatedEnd?: number | null;
  activeFrom?: number;
  /** How approximate the drawn section is, and when the notice was last checked. */
  mappingNote?: string;
  checkedOn?: string;
};
export type Instruction = {
  text: string;
  /** Meters since the previous emitted instruction (not cumulative distance from start). */
  distance: number;
  point?: Point;
  maneuver?: string;
};
export type Segment = {
  points: Point[];
  type: string;
  roles?: string[];
  routeRoles?: string[];
};
export type AccessGap = {
  id: string;
  /** "endpoint": the start or destination/return connection; "interior": between mapped parts of the route. */
  kind?: "endpoint" | "interior";
  distanceMeters: number;
  from: Point;
  to: Point;
  label: string;
};
export type RouteResult = {
  ok: true;
  route: unknown;
  segments: Segment[];
  distance: number;
  accessDistance: number;
  accessGaps?: AccessGap[];
  sharedDistance: number;
  kind: string;
  instructions: Instruction[];
  warnings: string[];
  closures: Closure[];
  key: string;
  canNavigate: boolean;
  /** PRIVATE TEST MODE: Start is allowed only because estimated connections are assumed traversable; they are still estimated. */
  assumedConnections?: boolean;
  /** The route uses proposed infrastructure, whether or not a segment carries the role. */
  proposed?: boolean;
  /** When the closure/warning status in this result was evaluated (epoch milliseconds). */
  evaluatedAt?: number;
  /** How the route compares with the trail data loaded now (the router recomputes this on every inspection). */
  network?: NetworkCheck;
  requestedDistance?: number;
  summary?: string;
  targetMatched?: boolean;
  retracedDistance?: number;
};
export type NetworkIssue = {
  code: string;
  featureId: string | null;
  detail: string;
};
/** current: verified against the loaded data. trusted: fixture only. stale/unverifiable: cannot be ridden as is. */
export type NetworkCheck = {
  status: "current" | "trusted" | "stale" | "unverifiable";
  checkedEdges: number;
  issues: NetworkIssue[];
  issueCount: number;
};
export const routeNeedsRecalculation = (result: {
  network?: NetworkCheck;
}): boolean =>
  result.network?.status === "stale" ||
  result.network?.status === "unverifiable";
export type Update = {
  id: string;
  /** Authoritative published guide category; unknown values remain visible. */
  category?: string;
  title: string;
  details: string;
  status: string;
  sourceUrl: string;
  source?: { url: string; title: string };
};
export type Network = {
  features: Feature[];
  closures: Closure[];
  updates: Update[];
  freshnessMessage: string;
  mode: "fixture" | "local" | "county";
  label: string;
  /** Identity the router echoed for the loaded data; null for private local review files. */
  dataset?: DatasetIdentity | null;
  datasetRecord?: DatasetRecord | null;
};
export const emptyDraft = (): Draft => ({
  mode: "point",
  start: null,
  destination: null,
  miles: 5,
  proposed: false,
});
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isEndpoint = (value: unknown): value is Endpoint =>
  isPoint(value) &&
  typeof (value as Endpoint).label === "string" &&
  ((value as Endpoint).address === undefined ||
    typeof (value as Endpoint).address === "string");
/** `miles` persists as null when the planner held NaN (JSON has no NaN). */
export const isDraft = (value: unknown): value is Draft =>
  isObject(value) &&
  (value.mode === "point" || value.mode === "loop") &&
  (value.start === null || isEndpoint(value.start)) &&
  (value.destination === null || isEndpoint(value.destination)) &&
  ((typeof value.miles === "number" && Number.isFinite(value.miles)) ||
    value.miles === null) &&
  typeof value.proposed === "boolean";
export const miles = (meters: number) => (meters / 1609.344).toFixed(1);
export function isPoint(p: unknown): p is Point {
  const q = p as Point;
  return (
    !!q &&
    Number.isFinite(q.latitude) &&
    Math.abs(q.latitude) <= 90 &&
    Number.isFinite(q.longitude) &&
    Math.abs(q.longitude) <= 180
  );
}

/** What the map draws besides the line, as the shared core computes it for native (TrailRouteMapCuesSijko). */
export type MapCuePiece = {
  /** Already in the direction of travel; a second pass is already shifted 8 m to the right so both stay visible. */
  points: Point[];
  type: string;
  isRouted: boolean;
  roles: string[];
  name: string | null;
  repeatsEarlierTravel: boolean;
  /** Navigation distance along the route at each point. */
  distances: number[];
};
export type MapCues = {
  pieces: MapCuePiece[];
  turnarounds: { point: Point; distance: number }[];
};
