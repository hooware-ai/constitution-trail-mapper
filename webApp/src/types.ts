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
};
export type Instruction = {
  text: string;
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
export type RouteResult = {
  ok: true;
  route: unknown;
  segments: Segment[];
  distance: number;
  accessDistance: number;
  sharedDistance: number;
  kind: string;
  instructions: Instruction[];
  warnings: string[];
  closures: Closure[];
  key: string;
  canNavigate: boolean;
  requestedDistance?: number;
  summary?: string;
  targetMatched?: boolean;
  retracedDistance?: number;
};
export type Update = {
  id: string;
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
  mode: "fixture" | "local";
  label: string;
};
export const emptyDraft = (): Draft => ({
  mode: "point",
  start: null,
  destination: null,
  miles: 5,
  proposed: false,
});
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
