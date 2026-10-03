// Release provenance: which source commit, Kotlin core and dataset produced exactly this web artifact.
//
// Nothing here trusts a recorded claim. Eligibility for public release is always RECOMPUTED from the dataset record,
// the shipped files and the current source state; a provenance.json that says otherwise is rejected as inconsistent.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { repoRoot, sha256, webRoot, verifyCoreManifest } from "./core.mjs";
import {
  accessManifestFile,
  approvalRecordFile,
  checkPackage,
  committedAccessManifestFile,
  committedApprovalFile,
  committedManifestFile,
  manifestFile,
  committedOsmManifestFile,
  committedProposedManifestFile,
  osmManifestFile,
  proposedManifestFile,
  readApprovalRecord,
} from "./dataset-package.mjs";
import {
  approvedCompositionProblems,
  reconstructComposition,
} from "./composition.mjs";

// TRAIL_DIST_DIR lets a test build a second artifact (for example a county build) without touching dist/.
export const distDir = process.env.TRAIL_DIST_DIR
  ? resolve(process.env.TRAIL_DIST_DIR)
  : join(webRoot, "dist");
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

// A leftover of the synthetic fixture network: it must never be inside a county artifact.
const FIXTURE_MARKER = "fixture-h-0-0";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The dataset a county artifact carries, judged from the shipped files and the COMMITTED approval record. Whatever the
 * shipped dataset.json claims about approval is compared with the committed record and any difference is a blocker.
 */
async function loadCountyDataset(dir, paths) {
  const record = JSON.parse(
    await readFile(join(dir, "data", "dataset.json"), "utf8"),
  );
  const approval = await readApprovalRecord(
    paths.approvalFile ?? approvalRecordFile,
  );
  const manifestPath = paths.manifestFile ?? manifestFile;
  const manifestBytes = await readFile(manifestPath);
  const inconsistencies = [];
  let body = null;
  let composition = null;
  try {
    body = await readFile(join(dir, "data", record.content.file));
    const proposedManifestBytes = record.proposedLayer
      ? await readFile(paths.proposedManifestFile ?? proposedManifestFile)
      : null;
    const osmManifestBytes = (record.supplements ?? []).length
      ? await readFile(paths.osmManifestFile ?? osmManifestFile)
      : null;
    const accessManifestBytes = record.access
      ? await readFile(paths.accessManifestFile ?? accessManifestFile)
      : null;
    const readPart = (name) => {
      // Access parts are named by hash and live beside the network; never follow a path out of data/.
      if (name.includes("/") || name.includes("\\") || name.includes(".."))
        return undefined;
      try {
        return readFileSync(join(dir, "data", name));
      } catch {
        return undefined;
      }
    };
    const network = checkPackage(
      record,
      body,
      manifestBytes,
      osmManifestBytes,
      readPart,
      proposedManifestBytes,
      accessManifestBytes,
    );
    // Reconstructed again here from the shipped bytes, so the verdict never rests on the record's own composition claim.
    composition = reconstructComposition({
      record,
      body,
      network,
      readPart,
      osmManifestBytes,
      proposedManifestBytes,
      accessManifestBytes,
    });
    if (
      record.access &&
      (paths.accessManifestFile ?? accessManifestFile) !==
        committedAccessManifestFile
    )
      inconsistencies.push(
        "dataset was packaged from an access source manifest other than the committed one",
      );
    if (record.access?.source?.testOnly === true)
      inconsistencies.push(
        "dataset access roads come from a test-only source manifest",
      );
    if (
      proposedManifestBytes &&
      (paths.proposedManifestFile ?? proposedManifestFile) !==
        committedProposedManifestFile
    )
      inconsistencies.push(
        "dataset was packaged from a proposed-trails manifest other than the committed one",
      );
    if (
      osmManifestBytes &&
      (paths.osmManifestFile ?? osmManifestFile) !== committedOsmManifestFile
    )
      inconsistencies.push(
        "dataset was packaged from an OpenStreetMap manifest other than the committed one",
      );
  } catch (error) {
    inconsistencies.push(`dataset content check failed: ${error.message}`);
  }
  const approvalPath = paths.approvalFile ?? approvalRecordFile;
  if (
    manifestPath !== committedManifestFile ||
    approvalPath !== committedApprovalFile
  )
    inconsistencies.push(
      "dataset was packaged from a manifest or approval record other than the committed ones",
    );
  for (const [name, shipped, committed] of [
    ["id", record.id, approval.id],
    ["approved", record.approval?.approved, approval.approved === true],
    ["approvedBy", record.approval?.approvedBy, approval.approvedBy ?? null],
    ["approvedOn", record.approval?.approvedOn, approval.approvedOn ?? null],
    ["attribution", record.source?.attribution, approval.attribution],
  ])
    if (shipped !== committed)
      inconsistencies.push(
        `shipped dataset ${name} differs from the committed approval record`,
      );
  // The shipped approval's expected composition must be the committed one, null and absent included.
  if (
    JSON.stringify(record.approval?.approvedComposition ?? null) !==
    JSON.stringify(approval.approvedComposition ?? null)
  )
    inconsistencies.push(
      "shipped dataset approvedComposition differs from the committed approval record",
    );
  for (const file of await artifactFiles(dir))
    if (
      /\.(js|json|html|css)$/.test(file.path) &&
      (await readFile(join(dir, ...file.path.split("/")), "utf8")).includes(
        FIXTURE_MARKER,
      )
    )
      inconsistencies.push(`fixture network data found in ${file.path}`);
  return {
    schema: 1,
    kind: "county",
    id: approval.id,
    version: record.version,
    approved: approval.approved === true,
    approvedBy: approval.approvedBy ?? null,
    approvedOn: approval.approvedOn ?? null,
    license: record.source?.license ?? null,
    attribution: approval.attribution,
    licenseEvidence: record.source?.licenseEvidenceUrl ?? null,
    sourceManifestSha256: record.source?.manifestSha256 ?? null,
    reviewedOn: record.source?.reviewedOn ?? null,
    extractedAtUtc: record.source?.extractedAtUtc ?? null,
    // What this artifact actually is, and what the committed record says an approval would cover. Integrity and
    // source review are checked above; neither is an approval, and neither of these is a publication approval.
    composition,
    approvedComposition: approval.approvedComposition ?? null,
    content: {
      distPath: `data/${record.content?.file}`,
      sha256: body ? sha256(body) : null,
      bytes: body ? body.length : null,
    },
    blockers: [...(approval.blockers ?? [])],
    inconsistencies,
  };
}

export async function loadDataset(paths = {}) {
  const dir = paths.distDir ?? distDir;
  if (await exists(join(dir, "data", "dataset.json")))
    return loadCountyDataset(dir, paths);
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
  for (const problem of dataset.inconsistencies ?? []) blockers.push(problem);
  for (const reason of dataset.blockers ?? [])
    blockers.push(`dataset: ${reason}`);
  if (dataset.approved !== true)
    blockers.push("dataset is not marked approved");
  if (dataset.kind !== "fixture" && dataset.approved === true) {
    for (const field of APPROVED_DATASET_FIELDS)
      if (!get(dataset, field))
        blockers.push(`approved dataset lacks ${field}`);
    // An approval covers exactly one composition. Absence of a bound composition fails closed.
    blockers.push(
      ...approvedCompositionProblems(
        dataset.composition,
        dataset.approvedComposition,
      ),
    );
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
  sourceManifestSha256: dataset.sourceManifestSha256 ?? null,
  reviewedOn: dataset.reviewedOn ?? null,
  extractedAtUtc: dataset.extractedAtUtc ?? null,
  composition: dataset.composition ?? null,
  approvedComposition: dataset.approvedComposition ?? null,
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
