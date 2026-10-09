// SYNTHETIC proposed trail segments and their reviewed manifest, in the real formats (tools/lib/proposed-layer.mjs). Two
// self-authored segments that continue the county fixture's west trail to a place only they reach:
//
//   west trail end (40.5, -88.99) --54:9999--> (40.48, -88.99) --54:9998--> proposed end (40.48, -88.97)
//
// 54:9999 is also the id the county fixture lists as omitted, so admitting it removes it from the omitted list. The
// geometry hashes are real digests of the synthetic paths. Not trail data; it proves nothing about any real extract.
import { createHash } from "node:crypto";

const digest = (paths) =>
  createHash("sha256").update(JSON.stringify(paths)).digest("hex");

export const proposedPlace = {
  label: "Synthetic proposed end",
  latitude: 40.48,
  longitude: -88.97,
};

const SEGMENTS = [
  [
    "54:9999",
    "Synthetic proposed south",
    [
      [
        [-88.99, 40.5],
        [-88.99, 40.49],
        [-88.99, 40.48],
      ],
    ],
  ],
  [
    "54:9998",
    "Synthetic proposed east",
    [
      [
        [-88.99, 40.48],
        [-88.98, 40.48],
        [-88.97, 40.48],
      ],
    ],
  ],
];

export function makeProposed({ granted = true } = {}) {
  const manifest = {
    schemaVersion: 1,
    reviewedOn: "2026-01-01",
    description: "Synthetic proposed segments.",
    rights: granted
      ? {
          status: "granted",
          basis: "Synthetic written grant from the synthetic owner.",
          evidenceUrl: "https://example.test/synthetic/grant",
          evidenceSha256: createHash("sha256")
            .update("synthetic grant")
            .digest("hex"),
          grantedBy: "Synthetic County GIS",
          grantedOn: "2026-01-01",
          license: "Synthetic Open License 1.0",
          licenseUrl: "https://example.test/synthetic/license",
          attribution: "Synthetic proposed-trail data, synthetic owner.",
        }
      : {
          status: "unresolved",
          blocker: "Synthetic: no redistribution grant has been found.",
          evidenceUrls: ["https://example.test/synthetic/metadata"],
        },
    features: SEGMENTS.map(([id, name, paths]) => ({
      id,
      name,
      geometrySha256: digest(paths),
    })),
  };
  const input = {
    job: "Synthetic proposed extract",
    layers: [
      {
        id: 54,
        name: "Synthetic Branches",
        features: [
          ...SEGMENTS.map(([id, name, paths]) => ({
            id,
            name,
            status: "Proposed",
            routeRoles: ["TrailBranches", "ProposedTrails"],
            enabledByDefault: false,
            paths,
          })),
          // Present in the extract but not in the manifest: it must never be admitted.
          {
            id: "54:9000",
            name: "Synthetic unreviewed proposed",
            status: "Proposed",
            routeRoles: ["TrailBranches", "ProposedTrails"],
            enabledByDefault: false,
            paths: [
              [
                [-88.5, 40.5],
                [-88.49, 40.5],
              ],
            ],
          },
        ],
      },
    ],
  };
  return { manifest, input };
}
