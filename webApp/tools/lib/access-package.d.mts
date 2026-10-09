export const ACCESS_INDEX_SCHEMA: string;
export const LOCAL_LAYER_ID: string;
export const CELLS_PER_DEGREE: number;
export const CELL_DEGREES: number;
export const WINDOW_CELLS: number;
export const RADIUS_METERS: number;
export const MAX_LATITUDE: number;
export class AccessPackageError extends Error {}
export function cellOf(latitude: number, longitude: number): [number, number];
export function cellKey(cell: [number, number]): string;
export function cellsOfFeature(feature: {
  paths: number[][][];
}): [number, number][];
export interface AccessPart {
  file: string;
  sha256: string;
  bytes: number;
}
export interface AccessDescriptor {
  base: AccessPart & { featureCount: number };
  index: AccessPart & {
    tileCount: number;
    localFeatureCount: number;
    tileAssignments: number;
    tileBytes: number;
  };
  cellDegrees: number;
  windowCells: number;
  radiusMeters: number;
}
export interface BuiltAccessParts {
  base: AccessPart & { body: Buffer; featureCount: number };
  tiles: (AccessPart & {
    lat: number;
    lon: number;
    body: Buffer;
    featureCount: number;
  })[];
  index: AccessPart & { body: Buffer };
  descriptor: AccessDescriptor;
  files: { file: string; body: Buffer }[];
}
export function buildAccessParts(inputText: string): BuiltAccessParts;
export function checkAccessParts(
  descriptor: AccessDescriptor,
  read: (file: string) => Buffer | undefined,
): { baseFeatures: number; tiles: number; localFeatures: number };
