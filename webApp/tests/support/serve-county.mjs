// Builds and serves a county-mode artifact from the SYNTHETIC package (tests/support/county-fixture.mjs) on a port
// this run owns. Nothing here reads or needs the private licensed extract; the data is not county data.
//
//   node tests/support/serve-county.mjs --port <n> [--public] [--osm] [--access] [--proposed] [--scale <features>] [--build-only]
//
// --osm also packages the SYNTHETIC reviewed OpenStreetMap supplement (tests/support/osm-fixture.mjs) as its own layer.
//
// --access also packages SYNTHETIC ordinary-road access (tests/support/access-fixture.mjs): base roads plus hash-named
// service-road tiles, loaded on demand.
//
// --proposed also packages SYNTHETIC proposed segments (tests/support/proposed-fixture.mjs) through the rights-gated seam,
// with a synthetic granted rights block, as an opt-in preview-only layer.
//
// --scale swaps the five-feature package for a synthetic lattice of that many features, for sizing only.
//
// Review and public builds use separate work and output directories so both can run at once.
//
// Output goes to webApp/dist-county-review or dist-county-public (ignored); the real dist/ is never touched.
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LIST, makeCounty, scaledList } from "./county-fixture.mjs";
import { makeSupplement } from "./osm-fixture.mjs";
import { closureTrailEntry, makeAccessExtract } from "./access-fixture.mjs";
import { makeProposed } from "./proposed-fixture.mjs";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const channel = process.argv.includes("--public") ? "public" : "review";
const withOsm = process.argv.includes("--osm");
const withAccess = process.argv.includes("--access");
const withProposed = process.argv.includes("--proposed");
const variant = [
  channel,
  withOsm ? "osm" : "",
  withAccess ? "access" : "",
  withProposed ? "proposed" : "",
]
  .filter(Boolean)
  .join("-");
const work = join(webRoot, "generated", `synthetic-${variant}`);
const county = join(work, "county");
const distDir = join(webRoot, `dist-county-${variant}`);
const windows = process.platform === "win32";

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const scaleArg = process.argv.indexOf("--scale");
// The access build also carries the trail the reported closure cuts, so the closure can be drawn (access-fixture.mjs).
const synthetic = makeCounty(
  scaleArg > 0
    ? { list: scaledList(Number(process.argv[scaleArg + 1])) }
    : process.argv.includes("--access")
      ? { list: [...DEFAULT_LIST, closureTrailEntry] }
      : {},
);
const files = {
  input: join(work, "extract.json"),
  manifest: join(work, "manifest.json"),
  approval: join(work, "approval.json"),
};
await writeFile(files.input, JSON.stringify(synthetic.input));
await writeFile(files.manifest, JSON.stringify(synthetic.manifest));
await writeFile(files.approval, JSON.stringify(synthetic.approval));
if (withOsm) {
  const supplement = makeSupplement();
  files.osmInput = join(work, "osm-additions.json");
  files.osmManifest = join(work, "osm-manifest.json");
  await writeFile(files.osmInput, JSON.stringify(supplement.input));
  await writeFile(files.osmManifest, JSON.stringify(supplement.manifest));
}

if (withProposed) {
  const proposed = makeProposed();
  files.proposedInput = join(work, "proposed-trails.json");
  files.proposedManifest = join(work, "proposed-manifest.json");
  await writeFile(files.proposedInput, JSON.stringify(proposed.input));
  await writeFile(files.proposedManifest, JSON.stringify(proposed.manifest));
}
if (withAccess) {
  files.accessInput = join(work, "access-roads.json");
  await writeFile(files.accessInput, JSON.stringify(makeAccessExtract()));
}

const env = {
  ...process.env,
  TRAIL_DATASET: "county",
  TRAIL_CHANNEL: channel,
  TRAIL_COUNTY_DIR: county,
  TRAIL_COUNTY_MANIFEST: files.manifest,
  TRAIL_COUNTY_APPROVAL: files.approval,
  TRAIL_DIST_DIR: distDir,
  ...(withOsm ? { TRAIL_OSM_MANIFEST: files.osmManifest } : {}),
  ...(withProposed ? { TRAIL_PROPOSED_MANIFEST: files.proposedManifest } : {}),
};
// The modules read these variables when first imported, so package in a child with the same environment.
const run = (label, args) => {
  // Only npx needs a shell on Windows; running node directly keeps paths with spaces intact.
  const result = spawnSync(args[0], args.slice(1), {
    cwd: webRoot,
    stdio: "inherit",
    shell: windows && args[0] !== "node",
    env,
  });
  if (result.status !== 0) {
    console.error(`serve-county: ${label} failed`);
    process.exit(result.status ?? 1);
  }
};
run("package", [
  "node",
  "tools/package-dataset.mjs",
  "--input",
  files.input,
  "--out",
  county,
  ...(withOsm ? ["--osm-additions", files.osmInput] : []),
  ...(withAccess ? ["--access-roads", files.accessInput] : []),
  ...(withProposed ? ["--proposed-trails", files.proposedInput] : []),
]);
run("build", ["npx", "vite", "build"]);
run("provenance", ["node", "tools/write-provenance.mjs"]);

if (process.argv.includes("--build-only")) {
  console.log(`Built ${distDir}`);
  process.exit(0);
}
process.env.TRAIL_DIST_DIR = distDir;
await import("../../tools/serve-dist.mjs");
