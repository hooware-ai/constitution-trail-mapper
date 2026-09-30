// Release provenance: which source commit, Kotlin core and dataset produced exactly this web artifact.
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { repoRoot, sha256, webRoot, verifyCoreManifest } from "./core.mjs";

export const distDir = join(webRoot, "dist");
export const datasetFile = join(webRoot, "release", "dataset.json");
const posix = (path) => path.split(sep).join("/");

function git(...args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

export function sourceState() {
  const commit = git("rev-parse", "HEAD");
  // Untracked build output is ignored; anything else that differs from the commit makes the artifact unreproducible.
  const status = git("status", "--porcelain", "--untracked-files=no");
  return {
    commit,
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    dirty: status === null ? null : status.length > 0,
  };
}

/** Fields a real dataset must carry before a public release may name it as approved (the #47 contract). */
export const APPROVED_DATASET_FIELDS = [
  "id",
  "version",
  "content.sha256",
  "sourceManifestSha256",
  "licenseEvidence",
  "attribution",
  "approvedBy",
  "approvedOn",
];
const get = (object, path) =>
  path
    .split(".")
    .reduce((value, key) => (value == null ? value : value[key]), object);

export async function loadDataset() {
  const dataset = JSON.parse(await readFile(datasetFile, "utf8"));
  if (dataset.content?.path) {
    const bytes = await readFile(join(webRoot, dataset.content.path));
    dataset.content = {
      ...dataset.content,
      sha256: sha256(bytes),
      bytes: bytes.length,
    };
  }
  return dataset;
}

/** Why this artifact may not be published, or an empty list. A file scan passing never approves data. */
export function publicReleaseBlockers(dataset, source) {
  const blockers = [];
  if (source?.dirty)
    blockers.push("built from a working tree with uncommitted changes");
  if (source?.dirty === null || source?.commit == null)
    blockers.push("source commit could not be determined");
  if (dataset.kind === "fixture")
    blockers.push("dataset is the synthetic fixture network");
  if (dataset.approved !== true)
    blockers.push("dataset is not marked approved");
  if (dataset.kind !== "fixture" && dataset.approved === true)
    for (const field of APPROVED_DATASET_FIELDS)
      if (!get(dataset, field))
        blockers.push(`approved dataset lacks ${field}`);
  return blockers;
}

async function walk(dir) {
  const nested = await Promise.all(
    (await readdir(dir, { withFileTypes: true })).map((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : [join(dir, entry.name)],
    ),
  );
  return nested.flat();
}

export async function artifactFiles(dir = distDir) {
  const files = (await walk(dir))
    .filter((file) => posix(relative(dir, file)) !== "provenance.json")
    .sort();
  const entries = [];
  for (const file of files) {
    const bytes = await readFile(file);
    entries.push({
      path: posix(relative(dir, file)),
      sha256: sha256(bytes),
      bytes: bytes.length,
    });
  }
  return entries;
}

export async function writeProvenance({ allowDirty = true } = {}) {
  const source = sourceState();
  if (source.dirty && !allowDirty)
    throw new Error(
      "The working tree has uncommitted changes to tracked files, so this artifact cannot be tied to a commit. Commit them (or pass --allow-dirty for a local, non-releasable build).",
    );
  const core = await verifyCoreManifest();
  const dataset = await loadDataset();
  const blockers = publicReleaseBlockers(dataset, source);
  const files = await artifactFiles();
  const provenance = {
    schema: 1,
    artifact: "trail-mapper-web",
    builtAt: new Date().toISOString(),
    source,
    core: {
      inputsSha256: core.inputs.sha256,
      outputSha256: core.outputs.sha256,
      builtAt: core.builtAt,
    },
    dataset: {
      kind: dataset.kind,
      id: dataset.id,
      version: dataset.version,
      approved: dataset.approved === true,
      contentSha256: dataset.content?.sha256 ?? null,
      license: dataset.license ?? null,
    },
    publicRelease: { allowed: blockers.length === 0, blockers },
    tools: { node: process.version },
    files,
    filesSha256: sha256(
      Buffer.from(
        files.map((f) => `${f.path}\t${f.sha256}`).join("\n"),
        "utf8",
      ),
    ),
  };
  await writeFile(
    join(distDir, "provenance.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  return provenance;
}

/** Recomputes every hash from the files on disk and compares them with the recorded provenance. */
export async function verifyProvenance() {
  const recorded = JSON.parse(
    await readFile(join(distDir, "provenance.json"), "utf8"),
  );
  const files = await artifactFiles();
  const problems = [];
  const byPath = new Map(recorded.files.map((f) => [f.path, f.sha256]));
  for (const file of files) {
    if (!byPath.has(file.path)) problems.push(`unrecorded file ${file.path}`);
    else if (byPath.get(file.path) !== file.sha256)
      problems.push(`modified file ${file.path}`);
    byPath.delete(file.path);
  }
  for (const missing of byPath.keys()) problems.push(`missing file ${missing}`);
  const core = await verifyCoreManifest();
  if (core.inputs.sha256 !== recorded.core.inputsSha256)
    problems.push(
      "artifact was built from different Kotlin sources than the current core",
    );
  const dataset = await loadDataset();
  if ((dataset.content?.sha256 ?? null) !== recorded.dataset.contentSha256)
    problems.push("dataset content differs from the recorded identity");
  if (problems.length)
    throw new Error("Provenance check failed: " + problems.join("; "));
  return recorded;
}

export async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
