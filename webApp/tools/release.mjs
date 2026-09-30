// One clean-source release check. From a fresh checkout it needs only the tools listed in docs/web/release.md and
// runs, in order and stopping at the first failure:
//   locked dependency install -> Kotlin bridge tests -> Kotlin core build (old output removed, manifest written)
//   -> type check -> unit tests -> production build (verifies the core manifest) -> provenance -> artifact audit
//   -> desktop+mobile browser suite on a port this run owns -> built-artifact smoke tests on another owned port.
// It has no dependencies of its own, so it works before `npm ci`.
//
//   node tools/release.mjs [--skip-install] [--skip-e2e] [--allow-dirty] [--public]
//
// --public additionally requires an approved dataset (see release/dataset.json): it fails today by design.
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot, webRoot } from "./lib/core.mjs";

const args = new Set(process.argv.slice(2));
const windows = process.platform === "win32";
const report = {
  startedAt: new Date().toISOString(),
  steps: [],
  args: [...args],
};

function run(label, command, commandArgs, options = {}) {
  console.log(`\n=== ${label}`);
  const started = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? webRoot,
    stdio: "inherit",
    shell: windows,
    env: { ...process.env, ...options.env },
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  report.steps.push({ label, ok: result.status === 0, seconds });
  if (result.status !== 0) {
    console.error(`\nFAILED: ${label} (exit ${result.status ?? "signal"})`);
    finish(1);
  }
}

function finish(code) {
  report.finishedAt = new Date().toISOString();
  report.ok = code === 0;
  mkdir(join(webRoot, "dist-report"), { recursive: true })
    .then(() =>
      writeFile(
        join(webRoot, "dist-report", "release-report.json"),
        JSON.stringify(report, null, 2) + "\n",
      ),
    )
    .finally(() => process.exit(code));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function requireTools() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error(
      `Node 22.12 or newer is required (found ${process.version}).`,
    );
  // Gradle's wrapper uses JAVA_HOME when it is set and the java on PATH otherwise: check the one it will use.
  const javaBin = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, "bin", "java")
    : "java";
  const java = spawnSync(javaBin, ["-version"], {
    encoding: "utf8",
    shell: windows && javaBin === "java",
  });
  const text = `${java.stderr ?? ""}${java.stdout ?? ""}`;
  const match = /version "(\d+)/.exec(text);
  if (!match || Number(match[1]) < 21)
    throw new Error(
      `JDK 21 or newer is required for the Gradle build: set JAVA_HOME or put it first on PATH (found: ${text.split("\n")[0] || "no java"}).`,
    );
  const git = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: windows,
    },
  );
  if (git.stdout.trim() && !args.has("--allow-dirty"))
    throw new Error(
      "Tracked files have uncommitted changes, so the artifact cannot be tied to a commit. Commit them, or pass --allow-dirty for a local build that is recorded as non-releasable.",
    );
}

try {
  requireTools();
} catch (error) {
  console.error(error.message);
  finish(2);
}

const gradle = windows ? "gradlew.bat" : "./gradlew";
if (!args.has("--skip-install"))
  run("Locked dependency install (npm ci)", "npm", ["ci"]);
run(
  "Kotlin bridge tests (JVM + JS)",
  gradle,
  [":webBridge:jvmTest", ":webBridge:jsNodeTest", "--console=plain"],
  { cwd: repoRoot },
);
run("Kotlin core build + manifest", "node", ["tools/build-core.mjs"]);
run("Type check", "npx", ["tsc", "--noEmit"]);
run("Unit tests", "npm", ["test"]);
run("Production build (verifies the core manifest)", "npx", ["vite", "build"]);
run("Provenance", "node", [
  "tools/write-provenance.mjs",
  ...(args.has("--allow-dirty") ? [] : ["--strict"]),
]);
run("Artifact audit", "node", [
  "tools/audit-dist.mjs",
  ...(args.has("--public") ? ["--public"] : []),
]);
run("Install the browser used by the suites", "npx", [
  "playwright",
  "install",
  "chromium",
]);
if (!args.has("--skip-e2e")) {
  const devPort = String(await freePort());
  run(
    `Browser suite: dev server, desktop + mobile (port ${devPort})`,
    "npx",
    ["playwright", "test"],
    {
      env: { TRAIL_TEST_PORT: devPort },
    },
  );
}
const distPort = String(await freePort());
run(
  `Built-artifact smoke tests (port ${distPort})`,
  "npx",
  ["playwright", "test", "-c", "playwright.dist.config.ts"],
  {
    env: { TRAIL_TEST_PORT: distPort },
  },
);
run("Re-verify provenance after the suites", "node", ["tools/audit-dist.mjs"]);

const provenance = JSON.parse(
  await readFile(join(webRoot, "dist", "provenance.json"), "utf8"),
);
console.log("\nRelease check passed.");
console.log(
  `  commit:   ${provenance.source.commit}${provenance.source.dirty ? " (dirty)" : ""}`,
);
console.log(
  `  core:     inputs ${provenance.core.inputsSha256.slice(0, 16)}  output ${provenance.core.outputSha256.slice(0, 16)}`,
);
console.log(
  `  dataset:  ${provenance.dataset.id}@${provenance.dataset.version} (${provenance.dataset.kind}, approved: ${provenance.dataset.approved})`,
);
console.log(
  `  artifact: dist/ ${provenance.files.length} files, ${provenance.filesSha256.slice(0, 16)}`,
);
console.log(
  `  public release: ${provenance.publicRelease.allowed ? "allowed" : "BLOCKED - " + provenance.publicRelease.blockers.join("; ")}`,
);
finish(0);
