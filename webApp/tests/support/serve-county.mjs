// Builds and serves a county-mode artifact from the SYNTHETIC package (tests/support/county-fixture.mjs) on a port
// this run owns. Nothing here reads or needs the private licensed extract; the data is not county data.
//
//   node tests/support/serve-county.mjs --port <n> [--public] [--scale <features>] [--build-only]
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
import { makeCounty, scaledList } from "./county-fixture.mjs";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const channel = process.argv.includes("--public") ? "public" : "review";
const work = join(webRoot, "generated", `synthetic-${channel}`);
const county = join(work, "county");
const distDir = join(webRoot, `dist-county-${channel}`);
const windows = process.platform === "win32";

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const scaleArg = process.argv.indexOf("--scale");
const synthetic = makeCounty(
  scaleArg > 0 ? { list: scaledList(Number(process.argv[scaleArg + 1])) } : {},
);
const files = {
  input: join(work, "extract.json"),
  manifest: join(work, "manifest.json"),
  approval: join(work, "approval.json"),
};
await writeFile(files.input, JSON.stringify(synthetic.input));
await writeFile(files.manifest, JSON.stringify(synthetic.manifest));
await writeFile(files.approval, JSON.stringify(synthetic.approval));

const env = {
  ...process.env,
  TRAIL_DATASET: "county",
  TRAIL_CHANNEL: channel,
  TRAIL_COUNTY_DIR: county,
  TRAIL_COUNTY_MANIFEST: files.manifest,
  TRAIL_COUNTY_APPROVAL: files.approval,
  TRAIL_DIST_DIR: distDir,
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
]);
run("build", ["npx", "vite", "build"]);
run("provenance", ["node", "tools/write-provenance.mjs"]);

if (process.argv.includes("--build-only")) {
  console.log(`Built ${distDir}`);
  process.exit(0);
}
process.env.TRAIL_DIST_DIR = distDir;
await import("../../tools/serve-dist.mjs");
