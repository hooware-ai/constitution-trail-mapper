// Stages a verified dist/ into a local directory and writes the manifest of what a host must serve. INERT: no host,
// account, credential, upload or network access; see tools/lib/stage-hosting.mjs.
//
//   node tools/stage-hosting.mjs [--dist <dir>] [--out <dir>] [--http] [--public]
//
// --public refuses an artifact that is not eligible for public release (the existing audit verdict, recomputed).
import { join } from "node:path";
import { webRoot } from "./lib/core.mjs";
import { distDir } from "./lib/provenance.mjs";
import { stageSite } from "./lib/stage-hosting.mjs";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const result = await stageSite({
  distDir: arg("--dist") ?? distDir,
  outDir: arg("--out") ?? join(webRoot, "generated", "staging"),
  https: !process.argv.includes("--http"),
  requirePublic: process.argv.includes("--public"),
});
const { plan, outDir } = result;
console.log(
  `Staged ${plan.files.length} files into ${outDir} (inert: nothing uploaded). ` +
    (plan.publicRelease.allowed
      ? "Artifact is eligible for public release."
      : "NOT approved for public release: " +
        plan.publicRelease.blockers.join("; ") +
        "."),
);
