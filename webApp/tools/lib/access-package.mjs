// Splits the ordinary-road access data into what the router needs at start-up and what it needs only near a trip's
// endpoints, so the browser never downloads the whole of it just to open the planner.
//
//  * base:  every road that is NOT an endpoint-local service road (the TIGER roads). Needed by every plan, hash-named.
//  * tiles: the endpoint-local service roads (layer "osm-service"), cut into 0.01 degree cells. A feature is written to
//           EVERY cell its bounding box intersects (never by centroid), so a long road that crosses several cells is in
//           each of them and a lookup never depends on where the road's middle happens to be.
//  * index: lists every tile with its SHA-256 and size; the dataset record pins the index by hash.
//
// Equivalence with the native adapter (AndroidAccessNetworkJsonReader / AccessNetworkFeatureProximitySijko): native
// keeps a service road when any point of any path segment lies within 600 m of an endpoint. A 3x3 block of cells
// around the endpoint's cell reaches at least one full cell (>= 0.01 degrees: 1113 m of latitude, and 845 m of
// longitude at the study area's latitude) beyond the endpoint in every direction, which is more than 600 m, and any
// feature with a point inside that reach has a bounding box that intersects one of those cells. The loader then hands
// the router the loaded roads and the router applies the exact 600 m filter itself, unchanged. The longitude cell
// shrinks with latitude, so the design is refused above MAX_LATITUDE (cos(56 degrees) * 1113 m = 622 m > 600 m).
//
// Everything here is pure: bytes in, bytes out. Nothing is fetched, and nothing about a real extract is assumed.
import { createHash } from "node:crypto";

export const ACCESS_INDEX_SCHEMA = "trail-mapper.access-index/1";
export const LOCAL_LAYER_ID = "osm-service";
export const CELLS_PER_DEGREE = 100;
export const CELL_DEGREES = 1 / CELLS_PER_DEGREE;
export const WINDOW_CELLS = 1;
export const RADIUS_METERS = 600;
export const MAX_LATITUDE = 56;

export class AccessPackageError extends Error {
  constructor(message) {
    super(message);
    this.name = "AccessPackageError";
  }
}
const refuse = (message) => {
  throw new AccessPackageError(message);
};

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** The cell a coordinate falls in. The loader uses the same arithmetic (src/accessTiles.ts); a test pins them equal. */
export function cellOf(latitude, longitude) {
  return [
    Math.floor(latitude * CELLS_PER_DEGREE),
    Math.floor(longitude * CELLS_PER_DEGREE),
  ];
}
export const cellKey = ([lat, lon]) => `${lat}_${lon}`;

function validated(inputText) {
  let input;
  try {
    input = JSON.parse(inputText.replace(/^﻿/, ""));
  } catch {
    refuse("The access road extract is not valid JSON.");
  }
  if (!input || !Array.isArray(input.layers))
    refuse("The access road extract has no layers.");
  const seen = new Set();
  const layers = input.layers.map((layer) => {
    if (!layer || !Array.isArray(layer.features))
      refuse("An access road layer has no features.");
    const features = layer.features.map((feature) => {
      if (!feature || typeof feature.id !== "string" || !feature.id)
        refuse("An access road has no identifier.");
      if (seen.has(feature.id))
        refuse(`Access road ${feature.id} appears more than once.`);
      seen.add(feature.id);
      if (!Array.isArray(feature.paths) || feature.paths.length === 0)
        refuse(`Access road ${feature.id} has no geometry.`);
      for (const path of feature.paths) {
        if (!Array.isArray(path) || path.length < 2)
          refuse(
            `Access road ${feature.id} has a path with fewer than two points.`,
          );
        for (const pair of path) {
          if (
            !Array.isArray(pair) ||
            pair.length < 2 ||
            !Number.isFinite(pair[0]) ||
            !Number.isFinite(pair[1]) ||
            Math.abs(pair[1]) > MAX_LATITUDE ||
            Math.abs(pair[0]) > 180
          )
            refuse(
              `Access road ${feature.id} has a coordinate this tile design cannot serve (latitude must be within ${MAX_LATITUDE} degrees).`,
            );
        }
      }
      // Only what the router reads, in a fixed order, so identical data always makes identical bytes.
      return {
        id: feature.id,
        ...(feature.name != null ? { name: feature.name } : {}),
        ...(feature.mtfcc != null ? { mtfcc: feature.mtfcc } : {}),
        paths: feature.paths.map((path) =>
          path.map(([longitude, latitude]) => [longitude, latitude]),
        ),
      };
    });
    return { id: layer.id, features };
  });
  return layers;
}

/** Every cell the feature's bounding box intersects (whole-feature assignment, never a centroid). */
export function cellsOfFeature(feature) {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const path of feature.paths)
    for (const [longitude, latitude] of path) {
      south = Math.min(south, latitude);
      north = Math.max(north, latitude);
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
    }
  const [south0, west0] = cellOf(south, west);
  const [north0, east0] = cellOf(north, east);
  const cells = [];
  for (let lat = south0; lat <= north0; lat++)
    for (let lon = west0; lon <= east0; lon++) cells.push([lat, lon]);
  return cells;
}

const layerBytes = (id, features) =>
  Buffer.from(JSON.stringify({ layers: [{ id, features }] }), "utf8");

/** Builds every file of the access package from the normalized extract. Deterministic: same input, same bytes. */
export function buildAccessParts(inputText) {
  const layers = validated(inputText);
  const baseLayers = layers.filter((layer) => layer.id !== LOCAL_LAYER_ID);
  // The access graph is built in feature order (it merges nearby nodes first-come), so the original position of every
  // service road travels with it: the core presents late-arriving tiles in the order a whole-file load would use.
  // That is only meaningful when service roads come after the base roads, as they do in the native extract.
  const firstLocal = layers.findIndex((layer) => layer.id === LOCAL_LAYER_ID);
  if (
    firstLocal >= 0 &&
    layers.slice(firstLocal).some((l) => l.id !== LOCAL_LAYER_ID)
  )
    refuse("Service roads must follow every base road layer in the extract.");
  const localFeatures = layers
    .filter((layer) => layer.id === LOCAL_LAYER_ID)
    .flatMap((layer) => layer.features)
    .map((feature, ord) => ({ ...feature, ord }));

  const baseBody = Buffer.from(JSON.stringify({ layers: baseLayers }), "utf8");
  const baseCount = baseLayers.reduce(
    (n, layer) => n + layer.features.length,
    0,
  );
  if (baseCount === 0)
    refuse(
      "The access road extract has no base roads; refusing a package that would route without roads.",
    );
  const base = {
    file: `access-base.${sha256(baseBody).slice(0, 12)}.json`,
    body: baseBody,
    sha256: sha256(baseBody),
    bytes: baseBody.length,
    featureCount: baseCount,
  };

  const byCell = new Map();
  let assignments = 0;
  for (const feature of localFeatures)
    for (const cell of cellsOfFeature(feature)) {
      const key = cellKey(cell);
      if (!byCell.has(key)) byCell.set(key, { cell, features: [] });
      byCell.get(key).features.push(feature);
      assignments++;
    }
  const tiles = [...byCell.values()]
    .sort((a, b) => a.cell[0] - b.cell[0] || a.cell[1] - b.cell[1])
    .map(({ cell, features }) => {
      const body = layerBytes(LOCAL_LAYER_ID, features);
      const digest = sha256(body);
      return {
        lat: cell[0],
        lon: cell[1],
        file: `access-tile.${cell[0]}_${cell[1]}.${digest.slice(0, 12)}.json`,
        body,
        sha256: digest,
        bytes: body.length,
        featureCount: features.length,
      };
    });

  const indexObject = {
    schema: ACCESS_INDEX_SCHEMA,
    cellDegrees: CELL_DEGREES,
    windowCells: WINDOW_CELLS,
    radiusMeters: RADIUS_METERS,
    maxLatitude: MAX_LATITUDE,
    localLayerId: LOCAL_LAYER_ID,
    base: {
      file: base.file,
      sha256: base.sha256,
      bytes: base.bytes,
      featureCount: base.featureCount,
    },
    localFeatureCount: localFeatures.length,
    tiles: tiles.map(
      ({ lat, lon, file, sha256: digest, bytes, featureCount }) => ({
        lat,
        lon,
        file,
        sha256: digest,
        bytes,
        featureCount,
      }),
    ),
  };
  const indexBody = Buffer.from(JSON.stringify(indexObject), "utf8");
  const index = {
    file: `access-index.${sha256(indexBody).slice(0, 12)}.json`,
    body: indexBody,
    sha256: sha256(indexBody),
    bytes: indexBody.length,
  };
  const tileBytes = tiles.reduce((n, tile) => n + tile.bytes, 0);
  return {
    base,
    tiles,
    index,
    // What the dataset record carries: enough to fetch and verify every part, and to size the whole.
    descriptor: {
      base: {
        file: base.file,
        sha256: base.sha256,
        bytes: base.bytes,
        featureCount: base.featureCount,
      },
      index: {
        file: index.file,
        sha256: index.sha256,
        bytes: index.bytes,
        tileCount: tiles.length,
        localFeatureCount: localFeatures.length,
        tileAssignments: assignments,
        tileBytes,
      },
      cellDegrees: CELL_DEGREES,
      windowCells: WINDOW_CELLS,
      radiusMeters: RADIUS_METERS,
    },
    files: [
      { file: base.file, body: base.body },
      { file: index.file, body: index.body },
      ...tiles.map((tile) => ({ file: tile.file, body: tile.body })),
    ],
  };
}

/**
 * Audits the written parts against the record's descriptor: every hash, the index/descriptor agreement, and that each
 * tile holds only features whose bounding box intersects its cell, with no repeats. `read(file)` returns the bytes.
 */
export function checkAccessParts(descriptor, read) {
  const fetchPart = (entry, what) => {
    const body = read(entry.file);
    if (!body) refuse(`The access ${what} (${entry.file}) is missing.`);
    if (sha256(body) !== entry.sha256 || body.length !== entry.bytes)
      refuse(
        `The access ${what} (${entry.file}) does not match its recorded hash.`,
      );
    if (!entry.file.includes(entry.sha256.slice(0, 12)))
      refuse(`The access ${what} (${entry.file}) is not named by its hash.`);
    return body;
  };
  const base = JSON.parse(
    fetchPart(descriptor.base, "base roads").toString("utf8"),
  );
  const baseCount = base.layers.reduce(
    (n, layer) => n + layer.features.length,
    0,
  );
  if (baseCount !== descriptor.base.featureCount)
    refuse("The access base road count does not match the record.");
  if (base.layers.some((layer) => layer.id === LOCAL_LAYER_ID))
    refuse("Service roads must be in tiles, not in the access base.");
  const index = JSON.parse(
    fetchPart(descriptor.index, "tile index").toString("utf8"),
  );
  if (index.schema !== ACCESS_INDEX_SCHEMA)
    refuse("The access tile index has an unknown schema.");
  if (
    index.cellDegrees !== descriptor.cellDegrees ||
    index.windowCells !== descriptor.windowCells ||
    index.radiusMeters !== descriptor.radiusMeters
  )
    refuse(
      "The access tile index disagrees with the record about its cell design.",
    );
  if (
    index.base.sha256 !== descriptor.base.sha256 ||
    index.base.file !== descriptor.base.file
  )
    refuse("The access tile index names a different base than the record.");
  if (index.tiles.length !== descriptor.index.tileCount)
    refuse("The access tile count does not match the record.");
  const seenCells = new Set();
  const seenFeatures = new Set();
  const idsByCell = new Map();
  const featureById = new Map();
  // The extract position of every service road is global, not per tile: the core relies on it to rebuild the whole-file
  // order, so two roads may never share one and, together, they must use every position from 0 with no gap.
  const idByOrd = new Map();
  let assignments = 0;
  let bytes = 0;
  for (const tile of index.tiles) {
    const key = cellKey([tile.lat, tile.lon]);
    if (seenCells.has(key)) refuse(`Access tile ${key} is listed twice.`);
    seenCells.add(key);
    const parsed = JSON.parse(fetchPart(tile, `tile ${key}`).toString("utf8"));
    const features = parsed.layers.flatMap((layer) => layer.features);
    if (
      parsed.layers.some((layer) => layer.id !== LOCAL_LAYER_ID) ||
      features.length !== tile.featureCount
    )
      refuse(`Access tile ${key} does not hold what the index says.`);
    const ids = new Set();
    let previousOrd = -1;
    for (const feature of features) {
      if (ids.has(feature.id))
        refuse(`Access tile ${key} repeats ${feature.id}.`);
      ids.add(feature.id);
      if (
        !Number.isInteger(feature.ord) ||
        feature.ord < 0 ||
        feature.ord <= previousOrd
      )
        refuse(`Access tile ${key} does not list its roads in extract order.`);
      previousOrd = feature.ord;
      if (idByOrd.has(feature.ord) && idByOrd.get(feature.ord) !== feature.id)
        refuse(
          `Access roads ${idByOrd.get(feature.ord)} and ${feature.id} share extract position ${feature.ord}.`,
        );
      idByOrd.set(feature.ord, feature.id);
      const earlier = featureById.get(feature.id);
      if (earlier && JSON.stringify(earlier) !== JSON.stringify(feature))
        refuse(
          `Access road ${feature.id} differs between the tiles that hold it.`,
        );
      seenFeatures.add(feature.id);
      featureById.set(feature.id, feature);
      if (
        !cellsOfFeature(feature).some(
          ([lat, lon]) => lat === tile.lat && lon === tile.lon,
        )
      )
        refuse(`Access road ${feature.id} does not touch tile ${key}.`);
    }
    idsByCell.set(key, ids);
    assignments += features.length;
    bytes += tile.bytes;
  }
  // Whole-feature assignment: a road is in EVERY cell its bounding box intersects, so none can be missing from one.
  for (const [id, feature] of featureById)
    for (const cell of cellsOfFeature(feature))
      if (!idsByCell.get(cellKey(cell))?.has(id))
        refuse(
          `Access road ${id} is missing from tile ${cellKey(cell)} that its bounding box intersects.`,
        );
  for (let ord = 0; ord < seenFeatures.size; ord++)
    if (!idByOrd.has(ord))
      refuse(
        `Access road extract positions are not dense: ${ord} is missing among ${seenFeatures.size} service roads.`,
      );
  if (
    seenFeatures.size !== descriptor.index.localFeatureCount ||
    assignments !== descriptor.index.tileAssignments ||
    bytes !== descriptor.index.tileBytes
  )
    refuse("The access tile totals do not match the record.");
  return {
    baseFeatures: baseCount,
    tiles: index.tiles.length,
    localFeatures: seenFeatures.size,
  };
}
