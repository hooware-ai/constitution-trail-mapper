// Shared helpers that tie the web bundle to the Kotlin core it was built from.
//
// The web app imports a generated Kotlin/JS library that is not tracked in Git. A normal Vite build cannot tell
// whether that library matches the current Kotlin sources, so the core build writes a manifest (hash of every input
// source and of the produced files) and every release build verifies it before it bundles anything.
import { createHash } from "node:crypto";
import {
  readFile,
  readdir,
  stat,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const webRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const repoRoot = resolve(webRoot, "..");
export const coreOutputDir = join(
  repoRoot,
  "webBridge",
  "build",
  "dist",
  "js",
  "productionLibrary",
);
export const coreEntry = join(coreOutputDir, "TrailMapper-webBridge.mjs");
/**
 * How to run the Gradle wrapper. On Windows the .bat goes through the shell with a quoted path (checkout paths
 * contain spaces). Elsewhere the script is run by `sh` explicitly, so a wrapper committed without its executable
 * bit (as this repository's is) still works on Linux.
 */
export function gradleInvocation(args) {
  if (process.platform === "win32")
    return {
      command: `"${join(repoRoot, "gradlew.bat")}"`,
      args,
      shell: true,
    };
  return {
    command: "sh",
    args: [join(repoRoot, "gradlew"), ...args],
    shell: false,
  };
}
export const coreManifestPath = join(
  repoRoot,
  "webBridge",
  "build",
  "trail-core.manifest.json",
);

/** Everything the Gradle task reads: both Kotlin modules and the build configuration they share. */
const INPUT_DIRS = ["sharedLogic/src", "webBridge/src"];
const INPUT_FILES = [
  "build.gradle.kts",
  "settings.gradle.kts",
  "gradle.properties",
  "gradle/libs.versions.toml",
  // The wrapper scripts, the wrapper jar that downloads Gradle, and the Kotlin/JS dependency lock all decide what
  // the build produces.
  "gradlew",
  "gradlew.bat",
  "gradle/wrapper/gradle-wrapper.properties",
  "gradle/wrapper/gradle-wrapper.jar",
  "kotlin-js-store/package-lock.json",
  "sharedLogic/build.gradle.kts",
  "webBridge/build.gradle.kts",
];
// Text files are hashed with normalised line endings (git may check the wrapper scripts out with CRLF on Windows).
const TEXT =
  /(\.(kt|kts|properties|toml|json|txt|md|xml|bat)|(^|[/\\])gradlew)$/i;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : [join(dir, entry.name)],
    ),
  );
  return nested.flat();
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Line endings must not change a hash: a Windows and a Linux checkout of the same commit hash equally. */
async function contentHash(file) {
  const bytes = await readFile(file);
  if (!TEXT.test(file)) return sha256(bytes);
  return sha256(
    Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8"),
  );
}

const posix = (path) => path.split(sep).join("/");

/** Hash of every core input file (path + normalised content), independent of order and platform. */
export async function coreInputs(root = repoRoot) {
  const files = [
    ...(
      await Promise.all(INPUT_DIRS.map((dir) => walk(join(root, dir))))
    ).flat(),
    ...INPUT_FILES.map((file) => join(root, file)),
  ];
  const present = [];
  for (const file of files) {
    try {
      if ((await stat(file)).isFile()) present.push(file);
    } catch {
      // A missing optional build file simply is not an input.
    }
  }
  present.sort();
  const lines = [];
  for (const file of present)
    lines.push(`${posix(relative(root, file))}\t${await contentHash(file)}`);
  return {
    count: lines.length,
    hash: sha256(Buffer.from(lines.join("\n"), "utf8")),
  };
}

/** Hash of the produced library: every emitted file, by relative path and bytes. */
export async function coreOutputs(dir = coreOutputDir) {
  const files = (await walk(dir)).sort();
  const entries = [];
  for (const file of files) {
    const bytes = await readFile(file);
    entries.push({
      path: posix(relative(dir, file)),
      sha256: sha256(bytes),
      bytes: bytes.length,
    });
  }
  return {
    files: entries,
    hash: sha256(
      Buffer.from(
        entries.map((e) => `${e.path}\t${e.sha256}`).join("\n"),
        "utf8",
      ),
    ),
  };
}

export async function removeCoreOutputs(paths = {}) {
  await rm(paths.distRoot ?? join(repoRoot, "webBridge", "build", "dist"), {
    recursive: true,
    force: true,
  });
  await rm(paths.manifestPath ?? coreManifestPath, { force: true });
}

/**
 * Records the manifest for the output on disk. `expectedInputsSha256` is the input hash captured BEFORE the build
 * started: if the sources changed while the compiler ran, the output cannot be attributed to either version, so
 * nothing is recorded.
 */
export async function writeCoreManifest(
  extra = {},
  paths = {},
  expectedInputsSha256,
) {
  const outputDir = paths.outputDir ?? coreOutputDir;
  const manifestPath = paths.manifestPath ?? coreManifestPath;
  const root = paths.root ?? repoRoot;
  const inputs = await coreInputs(root);
  if (expectedInputsSha256 && inputs.hash !== expectedInputsSha256)
    throw new Error(
      "The Kotlin sources or build files changed while the core was building, so the output cannot be tied to either version. Discarded; run the build again.",
    );
  const outputs = await coreOutputs(outputDir);
  if (
    !outputs.files.some((file) =>
      file.path.endsWith("TrailMapper-webBridge.mjs"),
    )
  )
    throw new Error(
      "The Kotlin core build produced no TrailMapper-webBridge.mjs.",
    );
  const manifest = {
    schema: 1,
    builtAt: new Date().toISOString(),
    inputs: { count: inputs.count, sha256: inputs.hash },
    outputs: { sha256: outputs.hash, files: outputs.files },
    ...extra,
  };
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/** Throws with an actionable message unless the on-disk core matches the current sources exactly. */
export async function verifyCoreManifest(paths = {}) {
  const outputDir = paths.outputDir ?? coreOutputDir;
  const manifestPath = paths.manifestPath ?? coreManifestPath;
  const root = paths.root ?? repoRoot;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(
      "No Kotlin core manifest: the generated core was not built by this checkout's build. Run `npm run build:core` (or `npm run release:check`).",
    );
  }
  const inputs = await coreInputs(root);
  if (inputs.hash !== manifest.inputs?.sha256)
    throw new Error(
      "Stale Kotlin core: the Kotlin sources or build files changed after the core was built. Run `npm run build:core` (or `npm run release:check`).",
    );
  const outputs = await coreOutputs(outputDir);
  if (outputs.hash !== manifest.outputs?.sha256)
    throw new Error(
      "The generated Kotlin core files do not match their build manifest (modified, copied or partially rebuilt). Run `npm run build:core`.",
    );
  return manifest;
}
