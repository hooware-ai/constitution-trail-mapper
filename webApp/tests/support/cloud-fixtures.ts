// SYNTHETIC records for the cloud contract: self-authored geometry and a fixture dataset identity. Nothing here is a
// rider's route, a real place, or county data; the dataset provenance is deliberately the synthetic review network's.
import {
  CURRENT_VERSION,
  buildPlaceFields,
  buildRouteFields,
  toRouteRecord,
  type CloudDatasetIdentity,
  type PlaceRecord,
  type RouteRecord,
} from "../../src/cloud/contract";

export const FIXTURE_DATASET: CloudDatasetIdentity = {
  kind: "fixture",
  id: "synthetic-review-network",
  version: "1",
  contentSha256: "a".repeat(64),
};
export const T0 = "2026-10-01T12:00:00.000Z";
export const T1 = "2026-10-01T13:30:00.000Z";

const pt = (latitude: number, longitude: number) => ({ latitude, longitude });
/** An engine-shaped route: display segments plus the identity-bearing edges the engine revalidates against. */
export function syntheticRoute(
  kind: "Navigation" | "ExerciseLoop" = "Navigation",
) {
  const trail = [pt(40.5, -88.99), pt(40.5, -88.97), pt(40.52, -88.97)];
  const access = [pt(40.52, -88.97), pt(40.5205, -88.9695)];
  return {
    kind,
    totalDistanceMeters: 4321.5,
    ordinaryAccessDistanceMeters: 70,
    sharedRoadwayDistanceMeters: 0,
    totalCost: 1,
    routeLayers: null,
    segments: [
      {
        type: "Trail",
        points: trail,
        isRouted: true,
        routeRoles: ["TrailBranches"],
      },
      { type: "Access", points: access, isRouted: false, routeRoles: [] },
    ],
    edges: [
      {
        id: 1,
        fromNodeId: 1,
        toNodeId: 2,
        sourceFeatureId: "54:9001",
        status: "Existing",
        routeSegments: [{ type: "Trail", points: trail, isRouted: true }],
      },
    ],
  };
}

export const ROUTE_ID = "r_0123456789abcdef0123456789abcdef";
export const PLACE_ID = "p_0123456789abcdef0123456789abcdef";
export const ROUTE_KEY = "route-0123456789abcdef";

export async function validRouteRecord(
  uid = "alice",
  options: {
    id?: string;
    kind?: "Navigation" | "ExerciseLoop";
    engine?: boolean;
  } = {},
): Promise<RouteRecord> {
  const kind = options.kind ?? "Navigation";
  const fields = await buildRouteFields({
    id: options.id ?? ROUTE_ID,
    ownerUid: uid,
    includeEngine: options.engine,
    local: {
      key: ROUTE_KEY,
      title: "Synthetic west to north",
      route: syntheticRoute(kind),
      draft:
        kind === "Navigation"
          ? {
              mode: "point",
              start: { label: "Synthetic west end", ...pt(40.5, -88.99) },
              destination: {
                label: "Synthetic north end",
                address: "Synthetic address",
                ...pt(40.52, -88.97),
              },
              miles: null,
              proposed: false,
            }
          : {
              mode: "loop",
              start: { label: "Synthetic west end", ...pt(40.5, -88.99) },
              destination: null,
              miles: 3,
              proposed: false,
            },
      dataset: FIXTURE_DATASET,
    },
  });
  return toRouteRecord(fields, { createdAt: T0, updatedAt: T0, revision: 1 });
}

export function validPlaceRecord(uid = "alice", id = PLACE_ID): PlaceRecord {
  const fields = buildPlaceFields({
    id,
    ownerUid: uid,
    label: "Synthetic trailhead",
    address: "Synthetic address, not a real place",
    latitude: 40.5,
    longitude: -88.99,
  });
  return { ...fields, createdAt: T0, updatedAt: T0, revision: 1 };
}

export { CURRENT_VERSION };
