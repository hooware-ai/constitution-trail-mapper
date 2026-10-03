import { createHash } from "node:crypto";
// SYNTHETIC ordinary-road access for the county fixture (tests/support/county-fixture.mjs): one TIGER-style base road far
// from everything, and an endpoint-local service road that is the ONLY way from a cul-de-sac start to the west end of the
// west trail. Self-authored geometry; it is not road data and proves nothing about any real extract.
//
//   start (40.4975, -89.0), exactly on the road  --service road-->  (40.4975, -88.99)  -->  (40.5, -88.99) = west trail end
//
// Without the service road tile the cul-de-sac is off the network (no navigable route); with it, the access is routed.
export const accessPlaces = {
  start: { label: "Synthetic cul-de-sac", latitude: 40.4975, longitude: -89.0 },
  end: { label: "Synthetic west end", latitude: 40.5, longitude: -88.99 },
};

const road = (id, name, ...points) => ({
  id,
  name,
  mtfcc: "S1400",
  paths: [points],
});

export function makeAccessExtract() {
  return {
    job: "Synthetic access roads (test fixture, not road data)",
    layers: [
      {
        id: "tiger",
        name: "Synthetic base roads",
        features: [
          road(
            "tiger:far",
            "Synthetic far road",
            [-88.93, 40.54],
            [-88.92, 40.54],
          ),
        ],
      },
      {
        id: "osm-service",
        name: "Synthetic service roads",
        features: [
          road(
            "osm:service:1",
            "Synthetic service road",
            [-89.0, 40.4975],
            [-88.99, 40.4975],
            [-88.99, 40.5],
          ),
          // A road in a distant cell no journey here touches: proves tiles are not all downloaded.
          road(
            "osm:service:far",
            "Synthetic distant service road",
            [-88.5, 40.3],
            [-88.499, 40.3],
          ),
        ],
      },
    ],
  };
}

// The trail the shared guide's reported closure cuts (id 54:1305, from 40.507656,-88.984202 to 40.509023,-88.984155). The
// access build carries a synthetic trail with that id and those vertices, so the closure has real geometry to draw and
// the map's closure-areas switch has something to switch. In the other builds the closure has no loaded trail and is not drawn.
export const closureTrailEntry = [
  "54:1305",
  "Synthetic Uptown trail",
  ["TrailBranches"],
  [
    [
      [-88.984202, 40.507656],
      [-88.984178, 40.508339],
      [-88.984155, 40.509023],
    ],
  ],
];

/**
 * A SYNTHETIC, explicitly test-only source manifest for a synthetic extract (`text` is the exact text written to disk).
 * It pins that file the way the committed manifest pins the real one; the release audit refuses any package made from
 * it, because it is not the committed manifest, and it says testOnly so no one can mistake it for a review.
 */
export function makeAccessManifest(text) {
  const extract = JSON.parse(text);
  const layerCounts = {};
  for (const layer of extract.layers)
    layerCounts[layer.id] =
      (layerCounts[layer.id] ?? 0) + layer.features.length;
  return {
    schemaVersion: 1,
    kind: "access-road-source",
    id: "synthetic-access-roads",
    testOnly: true,
    scope: "Synthetic test fixture. Not a source review of any real data.",
    sourceInputSha256: createHash("sha256")
      .update(Buffer.from(text, "utf8"))
      .digest("hex"),
    sourceInput: { layerCounts },
  };
}
