import { createHash } from "node:crypto";
import { buildAccessParts } from "../../tools/lib/access-package.mjs";
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
    // The ACTUAL source leg 97 to 98 of county trail 54:1305 (two unchanged source vertices, nothing inserted between
    // them): the scheduled Willow Street trail closure (from 2026-10-05T11:00:00Z) is clipped inside it at run time.
    // Rendering evidence only; the gate is proved with the real core in tests/unit/bridge-timed-closures.test.ts.
    [
      [-88.9843690241, 40.5096012799],
      [-88.9849653323, 40.516684074],
    ],
  ],
];

/**
 * A SYNTHETIC, explicitly test-only source manifest for a synthetic extract (`text` is the exact text written to disk).
 * It pins that file the way the committed manifest pins the real one; the release audit refuses any package made from
 * it, because it is not the committed manifest, and it says testOnly so no one can mistake it for a review.
 */
export function expectedTransformOf(text) {
  let descriptor;
  try {
    ({ descriptor } = buildAccessParts(text));
  } catch {
    // An extract the builder itself refuses has no transform; the packager then refuses it with the builder's reason.
    const none = "0".repeat(64);
    return {
      baseSha256: none,
      indexSha256: none,
      tileCount: 0,
      tileAssignments: 0,
    };
  }
  return {
    baseSha256: descriptor.base.sha256,
    indexSha256: descriptor.index.sha256,
    tileCount: descriptor.index.tileCount,
    tileAssignments: descriptor.index.tileAssignments,
  };
}

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
    // The expected transform digests of THIS synthetic input, as the committed manifest has for the real one.
    expectedTransform: expectedTransformOf(text),
  };
}
