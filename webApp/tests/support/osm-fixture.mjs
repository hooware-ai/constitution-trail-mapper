// A SYNTHETIC stand-in for the reviewed OpenStreetMap supplement (two self-authored "ways") and its committed review
// manifest, in the real formats. Geometry hashes are real digests of the synthetic points (compact JSON of [lon, lat]),
// exactly as the extractor computes them, so admission is exercised end to end. Not OpenStreetMap data.
import { createHash } from "node:crypto";

const ODBL = "Open Database License (ODbL) 1.0";
const COPYRIGHT = "https://www.openstreetmap.org/copyright";
const digest = (points) =>
  createHash("sha256").update(JSON.stringify(points)).digest("hex");

export function makeSupplement({ reviewedOn = "2026-01-01" } = {}) {
  const ways = [
    {
      wayId: 880001,
      version: 2,
      name: "Synthetic OSM east path",
      routeRole: "ParkConnectors",
      points: [
        [-88.95, 40.5],
        [-88.93, 40.5],
        [-88.93, 40.51],
      ],
      requiredTags: { highway: "path", surface: "asphalt" },
    },
    {
      wayId: 880002,
      version: 1,
      name: "Synthetic OSM pond loop",
      routeRole: "TrailBranches",
      points: [
        [-88.93, 40.51],
        [-88.92, 40.512],
        [-88.915, 40.508],
        [-88.93, 40.51],
      ],
      requiredTags: {
        highway: "path",
        surface: "asphalt",
        bicycle: "designated",
      },
    },
  ];
  const excludedUntilVerified = [
    "Synthetic gap: shown schematically on a map but no precise source line was found; do not bridge it.",
    "Synthetic future project: does not acquire existing status through this supplement.",
  ];
  const manifest = {
    schemaVersion: 1,
    reviewedOn,
    description: "Synthetic reviewed paths.",
    license: ODBL,
    attribution: "© OpenStreetMap contributors",
    licenseUrl: COPYRIGHT,
    features: ways.map((w) => ({
      wayId: w.wayId,
      version: w.version,
      geometrySha256: digest(w.points),
      name: w.name,
      routeRole: w.routeRole,
      requiredTags: w.requiredTags,
      bicycleEvidence: "Synthetic evidence.",
      sources: ["https://example.test/synthetic/evidence"],
    })),
    excludedUntilVerified,
  };
  const input = {
    job: "Synthetic reviewed OSM additions",
    reviewedOn,
    sources: {
      attribution: "© OpenStreetMap contributors",
      license: ODBL,
      licenseUrl: COPYRIGHT,
    },
    layers: [
      {
        id: "verified-osm",
        name: "Reviewed OpenStreetMap paths",
        features: ways.map((w) => ({
          id: `verified-osm:way:${w.wayId}`,
          name: w.name,
          status: "Existing",
          routeRoles: [w.routeRole],
          facilityType: "Off-Road Trail",
          comfort: "Unknown",
          surfaceType: "paved",
          enabledByDefault: true,
          paths: [w.points],
          provenance: {
            source: "OpenStreetMap",
            sourceUrl: `https://www.openstreetmap.org/way/${w.wayId}`,
            wayId: w.wayId,
            version: w.version,
            sourceTimestamp: "2026-01-01T00:00:00Z",
            geometrySha256: digest(w.points),
            sourceTags: { ...w.requiredTags },
            reviewedOn,
            bicycleEvidence: "Synthetic evidence.",
            openingSources: ["https://example.test/synthetic/evidence"],
            attribution: "© OpenStreetMap contributors",
            license: ODBL,
            licenseUrl: COPYRIGHT,
          },
        })),
      },
    ],
    excludedUntilVerified,
  };
  return { manifest, input };
}
