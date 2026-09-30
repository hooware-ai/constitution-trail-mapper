// Builds the Kotlin/JS core from this checkout. Old output is removed first, so a failed or skipped build can never
// leave a previous library in place, and a manifest ties the new output to the exact sources that produced it.
// The input hash is captured BEFORE the compiler runs and compared AFTER: a source edit made during the build could
// otherwise certify old output with new input hashes.
import { spawnSync } from "node:child_process";
import {
  coreInputs,
  gradleInvocation,
  repoRoot,
  removeCoreOutputs,
  writeCoreManifest,
} from "./lib/core.mjs";

function runGradle() {
  const { command, args, shell } = gradleInvocation([
    ":webBridge:jsBrowserProductionLibraryDistribution",
    "--console=plain",
  ]);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell,
  });
  if (result.status !== 0)
    throw new Error(
      `Kotlin core build failed (exit ${result.status ?? "signal"}).`,
    );
}

/** `run` and `paths` are injectable so tests can exercise the guard with a deterministic fake compiler. */
export async function buildCore({ run = runGradle, paths = {} } = {}) {
  await removeCoreOutputs(paths);
  const before = await coreInputs(paths.root);
  const started = Date.now();
  await run();
  try {
    return await writeCoreManifest(
      {
        gradleTask: ":webBridge:jsBrowserProductionLibraryDistribution",
        buildSeconds: Math.round((Date.now() - started) / 1000),
      },
      paths,
      before.hash,
    );
  } catch (error) {
    // Refuse the output as well as the manifest: nothing may consume a library we cannot attribute.
    await removeCoreOutputs(paths);
    throw error;
  }
}

if (process.argv[1]?.endsWith("build-core.mjs")) {
  buildCore()
    .then((manifest) =>
      console.log(
        `Kotlin core built: ${manifest.outputs.files.length} files, inputs ${manifest.inputs.sha256.slice(0, 12)}, output ${manifest.outputs.sha256.slice(0, 12)}.`,
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
