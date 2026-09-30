// Release provenance: which source commit, Kotlin core and dataset produced exactly this web artifact.
//
// Nothing here trusts a recorded claim. Eligibility for public release is always RECOMPUTED from the dataset record,
// the shipped files and the current source state; a provenance.json that says otherwise is rejected as inconsistent.
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { repoRoot, sha256, webRoot, verifyCoreManifest } from "./core.mjs";

export const distDir = join(webRoot, "dist");
export const datasetFile = join(webRoot, "release", "dataset.json");
const posix = (path) => path.split(sep).join("/");

function git(cwd, ...args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The commit and whether the tree matches it. Ignored build output is fine; tracked changes AND untracked files that
 * are not ignored (a stray Kotlin/config file the commit does not contain) both make the artifact unreproducible.
 */
export function sourceState(root = repoRoot) {
  const commit = git(root, "rev-parse", "HEAD");
  const status = git(root, "status", "--porcelain", "--untracked-files=all");
  return {
    commit,
    branch: git(root, "rev-parse", "--abbrev-ref", "HEAD"),
    dirty: status === null ? null : status.length > 0,
  };
}

/** Fields a real dataset must carry before a public release may name it as approved (the #47 contract). */
export const APPROVED_DATASET_FIELDS = [
  "id",
  "version",
  "content.sha256",
  "content.distPath",
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

export async function loadDataset(paths = {}) {
  const dataset = JSON.parse(
    await readFile(paths.datasetFile ?? datasetFile, "utf8"),
  );
  if (dataset.content?.path) {
    const bytes = await readFile(
      join(paths.webRoot ?? webRoot, dataset.content.path),
    );
    dataset.content = {
      ...dataset.content,
      sha256: sha256(bytes),
      bytes: bytes.length,
    };
  }
  return dataset;
}

/**
 * Why this artifact may not be published, or an empty list. A file scan passing never approves data, and an
 * approval flag alone never suffices: the record must be internally consistent and its content must be a file that
 * is actually in the artifact with the declared hash.
 */
export function publicReleaseBlockers(dataset, source, distFiles) {
  const blockers = [];
  if (source?.dirty)
    blockers.push(
      "built from a working tree with uncommitted or untracked source files",
    );
  if (source?.dirty === null || source?.commit == null)
    blockers.push("source commit could not be determined");
  if (dataset.kind === "fixture") {
    blockers.push("dataset is the synthetic fixture network");
    if (dataset.approved === true)
      blockers.push("a fixture dataset cannot be marked approved");
  }
  if (dataset.approved !== true)
    blockers.push("dataset is not marked approved");
  if (dataset.kind !== "fixture" && dataset.approved === true) {
    for (const field of APPROVED_DATASET_FIELDS)
      if (!get(dataset, field))
        blockers.push(`approved dataset lacks ${field}`);
    const distPath = get(dataset, "content.distPath");
    if (distPath && distFiles) {
      const shipped = distFiles.find((file) => file.path === distPath);
      if (!shipped)
        blockers.push(`dataset content ${distPath} is not in the artifact`);
      else if (shipped.sha256 !== get(dataset, "content.sha256"))
        blockers.push(
          `dataset content ${distPath} in the artifact does not match the declared hash`,
        );
    }
  }
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

const filesDigest = (files) =>
  sha256(
    Buffer.from(files.map((f) => `${f.path}\t${f.sha256}`).join("\n"), "utf8"),
  );
const datasetSummary = (dataset) => ({
  kind: dataset.kind,
  id: dataset.id,
  version: dataset.version,
  approved: dataset.approved === true,
  contentSha256: dataset.content?.sha256 ?? null,
  license: dataset.license ?? null,
});

/** `paths` and `source` are injectable for tests; production callers use the defaults. */
export async function writeProvenance({
  allowDirty = true,
  paths = {},
  source = sourceState(),
} = {}) {
  if (source.dirty && !allowDirty)
    throw new Error(
      "The working tree has uncommitted changes or untracked source files, so this artifact cannot be tied to a commit. Commit them (or pass --allow-dirty for a local, non-releasable build).",
    );
  const core = await verifyCoreManifest(paths.core);
  const dataset = await loadDataset(paths);
  const dir = paths.distDir ?? distDir;
  const files = await artifactFiles(dir);
  const blockers = publicReleaseBlockers(dataset, source, files);
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
    dataset: datasetSummary(dataset),
    publicRelease: { allowed: blockers.length === 0, blockers },
    tools: { node: process.version },
    files,
    filesSha256: filesDigest(files),
  };
  await writeFile(
    join(dir, "provenance.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  return provenance;
}

/**
 * Recomputes every claim in provenance.json from the files on disk and rejects any that differ: file hashes, the
 * core, the dataset identity, and the public-release verdict itself (a hand-edited `allowed: true` cannot pass).
 * With `requirePublic`, the artifact must also be eligible NOW: current clean commit equal to the recorded one and
 * no blockers from the recomputed evidence.
 */
export async function verifyProvenance({
  requirePublic = false,
  paths = {},
  source = requirePublic ? sourceState() : undefined,
} = {}) {
  const dir = paths.distDir ?? distDir;
  const recorded = JSON.parse(
    await readFile(join(dir, "provenance.json"), "utf8"),
  );
  const files = await artifactFiles(dir);
  const problems = [];
  const byPath = new Map(recorded.files.map((f) => [f.path, f.sha256]));
  for (const file of files) {
    if (!byPath.has(file.path)) problems.push(`unrecorded file ${file.path}`);
    else if (byPath.get(file.path) !== file.sha256)
      problems.push(`modified file ${file.path}`);
    byPath.delete(file.path);
  }
  for (const missing of byPath.keys()) problems.push(`missing file ${missing}`);
  if (recorded.filesSha256 !== filesDigest(files))
    problems.push("recorded file digest does not match the files");
  const core = await verifyCoreManifest(paths.core);
  if (core.inputs.sha256 !== recorded.core?.inputsSha256)
    problems.push(
      "artifact was built from different Kotlin sources than the current core",
    );
  if (core.outputs.sha256 !== recorded.core?.outputSha256)
    problems.push(
      "artifact records a different core output than the current one",
    );
  const dataset = await loadDataset(paths);
  if (
    JSON.stringify(datasetSummary(dataset)) !== JSON.stringify(recorded.dataset)
  )
    problems.push(
      "recorded dataset identity/approval differs from the dataset record and content",
    );
  // The verdict is recomputed from the recorded build-time source state and must equal what was recorded.
  const expected = publicReleaseBlockers(dataset, recorded.source, files);
  if (
    recorded.publicRelease?.allowed !== (expected.length === 0) ||
    JSON.stringify(recorded.publicRelease?.blockers ?? []) !==
      JSON.stringify(expected)
  )
    problems.push(
      "recorded public-release verdict is inconsistent with the evidence",
    );
  if (requirePublic) {
    const now = source ?? sourceState();
    if (recorded.source?.commit !== now.commit)
      problems.push(
        "artifact was built from a different commit than the current checkout",
      );
    for (const blocker of publicReleaseBlockers(dataset, now, files))
      problems.push(`not publishable: ${blocker}`);
  }
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
