// Stages a verified dist/ into a NEW local directory and writes the manifests of what a host must serve. INERT: no host,
// account, credential, upload or network access; see tools/lib/stage-hosting.mjs. It never replaces or merges an existing
// directory and has no deploy or upload command.
//
//   node tools/stage-hosting.mjs [--dist <dir>] [--out <new dir>] [--http] [--public]
//   node tools/stage-hosting.mjs --audit <staged dir>
//
// --public refuses an artifact that is not eligible for public release (the existing audit verdict, recomputed).
import { join } from "node:path";
import { webRoot } from "./lib/core.mjs";
import { distDir } from "./lib/provenance.mjs";
import { auditStage, stageSite } from "./lib/stage-hosting.mjs";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const auditOnly = arg("--audit");
if (auditOnly) {
  const audits = await auditStage(auditOnly);
  for (const [name, audit] of Object.entries(audits))
    console.log(
      `${name}: ${audit.ok ? "ok" : "FAILED: " + audit.problems.join("; ")}`,
    );
  process.exit(Object.values(audits).every((audit) => audit.ok) ? 0 : 1);
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const { plan, outDir } = await stageSite({
  distDir: arg("--dist") ?? distDir,
  outDir: arg("--out") ?? join(webRoot, "generated", `staging-${stamp}`),
  https: !process.argv.includes("--http"),
  requirePublic: process.argv.includes("--public"),
});
console.log(
  `Staged ${plan.files.length} original files plus the wrapper into ${outDir} (inert: nothing uploaded). ` +
    (plan.publicRelease.allowed
      ? "Artifact is eligible for public release."
      : "NOT approved for public release: " +
        plan.publicRelease.blockers.join("; ") +
        "."),
);
