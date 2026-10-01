// Measures what a saved route costs under the cloud contract, using the real routing core on the packaged county
// network (when one is available) or on the synthetic review network. Nothing is uploaded and nothing is written.
//
//   npx tsx tools/measure-cloud-payload.ts            (county package: TRAIL_COUNTY_DIR, else the synthetic network)
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
  LIMITS,
  buildRouteFields,
  CloudRecordError,
  type CloudDatasetIdentity,
} from "../src/cloud/contract";

const root = resolve(import.meta.dirname, "..", "..");
const core = await import(
  pathToFileURL(
    join(
      root,
      "webBridge",
      "build",
      "dist",
      "js",
      "productionLibrary",
      "TrailMapper-webBridge.mjs",
    ),
  ).href
);
const call = (request: unknown) =>
  JSON.parse(core.dispatch(JSON.stringify(request)));
const NOW = Date.parse("2026-09-30T15:00:00Z");

let trails: string, dataset: CloudDatasetIdentity, label: string;
const countyDir = process.env.TRAIL_COUNTY_DIR;
if (countyDir) {
  const record = JSON.parse(
    await readFile(join(countyDir, "dataset.json"), "utf8"),
  );
  trails = await readFile(join(countyDir, record.content.file), "utf8");
  dataset = {
    kind: "county",
    id: record.id,
    version: record.version,
    contentSha256: record.content.sha256,
  };
  label = "county package (real geometry)";
} else {
  trails = await readFile(
    join(root, "webApp", "src", "data", "review-network.json"),
    "utf8",
  );
  dataset = {
    kind: "fixture",
    id: "synthetic-review-network",
    version: "1",
    contentSha256: "0".repeat(64),
  };
  label = "synthetic review network";
}
const init = call({
  op: "initialize",
  trails,
  now: NOW,
  trustSerializedRoutes: !countyDir,
});
if (init.ok === false) throw new Error(init.error);
const features = JSON.parse(trails).layers[0].features as Array<{
  paths: number[][][];
}>;
const mid = (f: { paths: number[][][] }) => {
  const line = f.paths[0];
  const p = line[Math.floor(line.length / 2)];
  return { latitude: p[1], longitude: p[0] };
};

const rows: Record<string, unknown>[] = [];
async function measure(name: string, request: Record<string, unknown>) {
  const result = call({ op: "plan", proposed: false, now: NOW, ...request });
  if (!result.route) {
    rows.push({ name, error: result.error });
    return;
  }
  const json = JSON.stringify(result.route);
  const row: Record<string, unknown> = {
    name,
    miles: Math.round((result.distance / 1609.344) * 10) / 10,
    localRouteJsonBytes: json.length,
    localRouteGzipBytes: gzipSync(json).length,
  };
  try {
    const fields = await buildRouteFields({
      id: "r".repeat(32),
      ownerUid: "uid-measure",
      local: {
        key: "route-0123456789abcdef",
        title: name,
        route: result.route,
        draft: {
          mode: request.miles ? "loop" : "point",
          start: { label: "Start", ...(request.start as object) } as never,
          destination: request.destination
            ? ({ label: "End", ...(request.destination as object) } as never)
            : null,
          miles: (request.miles as number) ?? null,
          proposed: false,
        },
        dataset,
      },
    });
    row.geometryChars = fields.geometry.length;
    row.points = fields.pointCount;
    row.engineBytes = fields.engine?.length;
    row.documentBytesApprox =
      fields.geometry.length + (fields.engine?.length ?? 0) + 2_500;
    row.fitsDocument = (row.documentBytesApprox as number) <= 1_048_576;
  } catch (error) {
    row.refused =
      error instanceof CloudRecordError
        ? `${error.code}: ${error.message}`
        : String(error);
  }
  rows.push(row);
}

const a = mid(features[Math.min(50, features.length - 1)]);
const b = mid(features[Math.min(200, features.length - 1)]);
await measure("point-to-point", { start: a, destination: b });
for (const miles of [5, 10, 25, 50, 100])
  await measure(`${miles}-mile loop`, { start: a, miles });
console.log(
  JSON.stringify({ source: label, limits: LIMITS, routes: rows }, null, 2),
);
