// Records the evidence needed to explain why the Kotlin core's output hash can differ between machines for identical
// inputs. It reads what the one normal core build already produced (no second build, no network, no secrets) and writes,
// next to the other release evidence in dist-report/:
//   - an unchanged copy of the core manifest (the release check's negative step deletes the original),
//   - per output file: path, raw SHA-256, bytes, SHA-256 of the LF-normalized bytes, and counts of CRLF and bare CR,
//   - the raw bytes of the source maps (raw-source-maps/), so their contents can be compared across machines,
//   - commit and platform (OS, architecture, Node, Git autocrlf).
// It judges nothing and changes nothing: comparing two machines' files is a later, separate step.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coreManifestPath,
  coreOutputDir,
  repoRoot,
  webRoot,
} from "./lib/core.mjs";

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Counts of CRLF pairs and of CR bytes that are not part of a CRLF. */
export function lineEndingCounts(buffer) {
  let crlf = 0;
  let bareCr = 0;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] !== 0x0d) continue;
    if (buffer[index + 1] === 0x0a) crlf++;
    else bareCr++;
  }
  return { crlf, bareCr };
}

/** SHA-256 of the bytes with every CRLF and bare CR turned into LF. */
export function lfNormalizedSha256(buffer) {
  const text = buffer.toString("latin1").replace(/\r\n?/g, "\n");
  return sha256(Buffer.from(text, "latin1"));
}

export function describeOutput(path, buffer) {
  return {
    path,
    bytes: buffer.length,
    sha256: sha256(buffer),
    lfNormalizedSha256: lfNormalizedSha256(buffer),
    ...lineEndingCounts(buffer),
  };
}

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function collect({
  manifestPath = coreManifestPath,
  outputDir = coreOutputDir,
  reportDir = join(webRoot, "dist-report", "core-hash-diagnostic"),
} = {}) {
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  mkdirSync(reportDir, { recursive: true });
  copyFileSync(manifestPath, join(reportDir, "trail-core.manifest.json"));
  // The source maps are where two machines' outputs were seen to differ (the executable files matched byte for byte), so
  // their raw bytes are kept for a later content comparison. Nothing else is copied.
  const rawDir = join(reportDir, "raw-source-maps");
  mkdirSync(rawDir, { recursive: true });
  const outputs = manifest.outputs.files.map((entry) => {
    const bytes = readFileSync(join(outputDir, entry.path));
    if (entry.path.endsWith(".map"))
      writeFileSync(join(rawDir, entry.path), bytes);
    return {
      ...describeOutput(entry.path, bytes),
      manifestSha256: entry.sha256,
      manifestBytes: entry.bytes,
    };
  });
  const diagnostic = {
    schema: 1,
    note: "Evidence only. Two machines' files are compared by a later step; nothing here asserts why an output hash differs.",
    commit: process.env.GITHUB_SHA ?? git(["rev-parse", "HEAD"]),
    platform: {
      os: platform(),
      osRelease: release(),
      arch: arch(),
      node: process.version,
      runner: process.env.RUNNER_OS ?? null,
      image: process.env.ImageOS ?? null,
      imageVersion: process.env.ImageVersion ?? null,
      gitAutocrlf: git(["config", "--get", "core.autocrlf"]),
    },
    manifest: {
      sha256: sha256(manifestBytes),
      inputsSha256: manifest.inputs.sha256,
      outputsSha256: manifest.outputs.sha256,
      builtAt: manifest.builtAt,
    },
    outputs,
  };
  writeFileSync(
    join(reportDir, "core-hash-diagnostic.json"),
    JSON.stringify(diagnostic, null, 2) + "\n",
  );
  return diagnostic;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const diagnostic = collect();
  console.log(
    `Core hash diagnostic: ${diagnostic.outputs.length} files, inputs ${diagnostic.manifest.inputsSha256.slice(0, 12)}, output ${diagnostic.manifest.outputsSha256.slice(0, 12)}, commit ${String(diagnostic.commit).slice(0, 12)}, ${diagnostic.platform.os}/${diagnostic.platform.arch}.`,
  );
}
