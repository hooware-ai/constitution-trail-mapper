// A SYNTHETIC stand-in for the private licensed extract and its reviewed manifest, in the real file formats.
// Self-authored geometry near the review area; hashes are arbitrary. It exercises the packaging, loading and
// revalidation code paths without any county data. It is not county data and proves nothing about it.
import { createHash } from "node:crypto";

const hex = (seed) => createHash("sha256").update(seed).digest("hex");
const LIST = [
  // id, name, roles, paths (lon,lat)
  [
    "54:9001",
    "Synthetic west trail",
    ["TrailBranches"],
    [
      [
        [-88.99, 40.5],
        [-88.97, 40.5],
      ],
    ],
  ],
  [
    "54:9002",
    "Synthetic north trail",
    ["TrailBranches"],
    [
      [
        [-88.97, 40.5],
        [-88.97, 40.52],
      ],
    ],
  ],
  [
    "16:9003",
    "Synthetic east connector",
    ["ParkConnectors"],
    [
      [
        [-88.97, 40.52],
        [-88.95, 40.52],
      ],
    ],
  ],
  [
    "16:9004",
    "Synthetic return trail",
    ["ParkConnectors"],
    [
      [
        [-88.95, 40.52],
        [-88.95, 40.5],
        [-88.97, 40.5],
      ],
    ],
  ],
  [
    "16:9005",
    "Synthetic detached trail",
    ["ParkConnectors"],
    [
      [
        [-88.9, 40.55],
        [-88.88, 40.55],
      ],
    ],
  ],
];
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
const SOURCE_URL = "https://example.test/synthetic/MapServer/8";

/**
 * A lattice of `count` synthetic trail features (about `vertices` vertices each) with shared, connected junctions, for
 * sizing the loading path at roughly county scale. Self-authored, wiggled so vertices are not collinear.
 */
export function scaledList(count = 254, vertices = 40, columns = 12) {
  const list = [];
  const at = (column, row) => [-89.03 + column * 0.006, 40.45 + row * 0.005];
  const rows = Math.ceil(count / (2 * columns)) + 2;
  const edges = [];
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      if (column + 1 < columns)
        edges.push([at(column, row), at(column + 1, row), "h"]);
      if (row + 1 < rows)
        edges.push([at(column, row), at(column, row + 1), "v"]);
    }
  for (let index = 0; index < count; index++) {
    const [from, to] = edges[index];
    const path = [];
    for (let step = 0; step <= vertices; step++) {
      const t = step / vertices;
      const wiggle =
        Math.sin(t * Math.PI * 6) * 0.00004 * Math.sin(t * Math.PI);
      path.push([
        from[0] +
          (to[0] - from[0]) * t +
          (edges[index][2] === "v" ? wiggle : 0),
        from[1] +
          (to[1] - from[1]) * t +
          (edges[index][2] === "h" ? wiggle : 0),
      ]);
    }
    const layer = index % 4 === 0 ? 16 : 54;
    list.push([
      `${layer}:${20000 + index}`,
      `Synthetic lattice trail ${index}`,
      [layer === 16 ? "ParkConnectors" : "TrailBranches"],
      [path],
    ]);
  }
  return list;
}

export function makeCounty({
  reviewedOn = "2026-01-01",
  excluded = [9999],
  list = LIST,
} = {}) {
  const entries = list.map(([id, , roles]) => {
    const [layer, objectId] = id.split(":").map(Number);
    return {
      selectionLayerId: layer,
      objectId,
      geometrySha256: hex("g" + id),
      attributesSha256: hex("a" + id),
      routeRoles: roles,
    };
  });
  const layerCounts = {};
  for (const e of entries)
    layerCounts[e.selectionLayerId] =
      (layerCounts[e.selectionLayerId] ?? 0) + 1;
  const manifest = {
    schemaVersion: 1,
    reviewedOn,
    evidenceVerifiedAtUtc: "2026-01-01T12:00:00+00:00",
    licensedItemId: "synthetic-item",
    licensedSourceUrl: SOURCE_URL,
    license: "CC BY 4.0",
    licenseUrl: LICENSE_URL,
    licenseEvidenceUrl: "https://example.test/synthetic/item.json",
    reviewedFeatureCount: entries.length,
    reviewedLayerCounts: layerCounts,
    features: entries,
    excludedUntilVerified: [
      {
        selectionLayerId: 54,
        objectIds: excluded,
        reason: "Synthetic proposed geometry; basis unresolved.",
      },
      { reason: "Other features outside the reviewed subset." },
    ],
  };
  const input = {
    job: "Synthetic reviewed licensed county trails",
    generatedAtUtc: "2026-01-02T03:04:05+00:00",
    reviewedOn,
    sources: {
      attribution: "Synthetic county",
      license: "CC BY 4.0",
      licenseUrl: LICENSE_URL,
      licensedItemId: "synthetic-item",
      licenseEvidenceUrl: "https://example.test/synthetic/item.json",
      licenseEvidenceSha256: hex("license-evidence"),
      licensedSourceUrl: SOURCE_URL,
      changes:
        "Reviewed subset selected; attributes decoded and normalized; source geometry retained.",
      disclaimer:
        "Source data is for display and reference. Current access and accuracy are not guaranteed.",
    },
    layers: [
      {
        id: 8,
        name: "Reviewed licensed synthetic trails",
        featureCount: list.length,
        features: list.map(([id, name, roles, paths]) => ({
          id,
          sourceLayerId: 8,
          objectId: Number(id.split(":")[1]),
          name,
          statusCode: "1",
          status: "Existing",
          routeRoles: roles,
          facilityType: "Separated Trail",
          comfort: "All Ages and Abilities",
          enabledByDefault: true,
          paths,
          provenance: {
            sourceUrl: SOURCE_URL,
            license: "CC BY 4.0",
            licenseUrl: LICENSE_URL,
            geometrySha256: hex("g" + id),
            attributesSha256: hex("a" + id),
            selectionLayerId: Number(id.split(":")[0]),
            reviewedOn,
          },
        })),
      },
    ],
  };
  const approval = {
    schema: 1,
    kind: "county",
    id: "synthetic-county",
    label: "Synthetic county candidate",
    approved: false,
    approvedBy: null,
    approvedOn: null,
    attribution: "Trail data: Synthetic county, licensed CC BY 4.0.",
    omitted: {
      supplements: "No supplements.",
      accessRoads: "No street access.",
    },
    blockers: ["Synthetic data is never releasable."],
  };
  return { manifest, input, approval };
}
