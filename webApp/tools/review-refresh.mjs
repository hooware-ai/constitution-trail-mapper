import { runReviewedRouterControls } from "./lib/reviewed-router-controls.mjs";
// node tools/review-refresh.mjs --config <reviewer-owned.json> --out <private-output>
// Offline inputs only; emits an immutable, nonreleasable review artifact.
import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { reviewRefresh, writeReviewArtifact } from "./lib/reviewed-refresh.mjs";
const option = (name) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith("--"))
    throw new Error(`Required ${name}`);
  return process.argv[i + 1];
};
try {
  const file = resolve(option("--config"));
  const root = dirname(file);
  const config = JSON.parse(await readFile(file, "utf8"));
  if (config.schema !== "trail-mapper.refresh-input/1")
    throw new Error("Unsupported review input schema");
  const bytes = (path) => readFile(resolve(root, path));
  const json = async (path) => JSON.parse((await bytes(path)).toString("utf8"));
  const snapshot = async (spec) => {
    const record = await json(join(spec.dir, "dataset.json"));
    if (!/^[a-zA-Z0-9_.-]+$/.test(record.content?.file ?? ""))
      throw new Error("Unsafe content file");
    const parts = {};
    for (const name of spec.parts ?? []) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error("Unsafe part name");
      parts[name] = await bytes(join(spec.dir, name));
    }
    const result = {
      record,
      body: await bytes(join(spec.dir, record.content.file)),
      manifestBytes: await bytes(spec.manifest),
      parts,
    };
    for (const key of [
      "osmManifestBytes",
      "proposedManifestBytes",
      "accessManifestBytes",
    ])
      if (spec[key]) result[key] = await bytes(spec[key]);
    return result;
  };
  const evidence = {};
  for (const [hash, path] of Object.entries(config.evidence ?? {}))
    evidence[hash] = await bytes(path);
  const baseline = await snapshot(config.baseline);
  const target = await snapshot(config.target);
  const baselineLedger = await json(config.ledger);
  const report = reviewRefresh({
    baseline,
    target,
    ledger: baselineLedger,
    candidates: await json(config.candidates),
    decisions: await json(config.decisions),
    policy: await json(config.policy),
    evidence,
  });
  const routerAdmission = config.routerControls
    ? await runReviewedRouterControls({
        report,
        snapshot: target,
        cases: await json(config.routerControls.cases),
        now: config.routerControls.now,
      })
    : null;
  const artifact = await writeReviewArtifact({
    outDir: resolve(option("--out")),
    report,
    baseline,
    target,
    baselineLedger,
    evidence,
    routerAdmission,
  });
  console.log(
    JSON.stringify(
      {
        dir: artifact.dir,
        version: report.version,
        artifactSha256: artifact.artifactSha256,
        release: report.release,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
