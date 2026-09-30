// Builds the Kotlin/JS core from this checkout. Old output is removed first, so a failed or skipped build can never
// leave a previous library in place, and a manifest ties the new output to the exact sources that produced it.
import { spawnSync } from "node:child_process";
import { repoRoot, removeCoreOutputs, writeCoreManifest } from "./lib/core.mjs";

const windows = process.platform === "win32";

export async function buildCore() {
  await removeCoreOutputs();
  const started = Date.now();
  const result = spawnSync(
    windows ? "gradlew.bat" : "./gradlew",
    [":webBridge:jsBrowserProductionLibraryDistribution", "--console=plain"],
    { cwd: repoRoot, stdio: "inherit", shell: windows },
  );
  if (result.status !== 0)
    throw new Error(
      `Kotlin core build failed (exit ${result.status ?? "signal"}).`,
    );
  const manifest = await writeCoreManifest({
    gradleTask: ":webBridge:jsBrowserProductionLibraryDistribution",
    buildSeconds: Math.round((Date.now() - started) / 1000),
  });
  console.log(
    `Kotlin core built: ${manifest.outputs.files.length} files, inputs ${manifest.inputs.sha256.slice(0, 12)}, output ${manifest.outputs.sha256.slice(0, 12)}.`,
  );
  return manifest;
}

if (process.argv[1]?.endsWith("build-core.mjs")) {
  buildCore().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
