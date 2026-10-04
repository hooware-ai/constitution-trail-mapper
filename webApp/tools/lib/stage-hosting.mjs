// INERT hosting preparation: turns a verified build artifact into a local, provider-neutral staging directory, adds the
// optional Pages advanced-mode wrapper (`_worker.js`, `_routes.json`) beside it, and records original and wrapper audits
// SEPARATELY. It selects no host, reads no account or credential, opens no network connection and uploads nothing; it only
// reads the artifact and writes under a directory that must not exist yet. The response policy is the existing
// hosting/headers.mjs, inlined verbatim into the worker, not a second copy of it.
import { createHash } from "node:crypto";
import { realpath as realpathCallback } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import {
  cacheControlFor,
  mimeTypes,
  securityHeaders,
} from "../../hosting/headers.mjs";
import {
  PREVIEW_CONTROL_FILES,
  PREVIEW_RESERVED_NAMESPACES,
} from "../../hosting/preview-adapter.mjs";
import { artifactFiles, verifyProvenance } from "./provenance.mjs";

export const STAGE_SCHEMA = "trail-mapper.stage/1";
export const ORIGINAL_AUDIT_SCHEMA = "trail-mapper.stage-original-audit/1";
export const HOSTING_SCHEMA = "trail-mapper.stage-hosting/1";
const HASHED_NAME = /\.[0-9a-zA-Z_-]{8,}\.[a-z0-9]+$/;
const WRAPPER_FILES = ["_worker.js", "_routes.json"];
const HEADERS_SOURCE = new URL("../../hosting/headers.mjs", import.meta.url);
const ADAPTER_SOURCE = new URL(
  "../../hosting/preview-adapter.mjs",
  import.meta.url,
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const filesDigest = (files) =>
  sha256(
    Buffer.from(files.map((f) => `${f.path}\t${f.sha256}`).join("\n"), "utf8"),
  );

/** Everything a host needs for one file, from the existing policy only. */
export function responseFor(path, { https = true } = {}) {
  const urlPath = "/" + path;
  const contentType = mimeTypes[extname(path)] ?? null;
  return {
    contentType,
    cacheControl: cacheControlFor(urlPath),
    headers: securityHeaders({ https }),
  };
}

/**
 * The deterministic staging plan. `problems` are things a host cannot serve correctly as the policy is written (an unknown
 * content type, an asset that is not content-hashed so cannot be cached forever); `publicRelease` is the artifact's
 * recomputed verdict, copied, never decided here.
 */
export function planStaging({ files, publicRelease, https = true }) {
  const problems = [];
  const planned = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => {
      const response = responseFor(file.path, { https });
      if (!response.contentType)
        problems.push(
          `${file.path}: no content type is defined for ${extname(file.path) || "(none)"}`,
        );
      if (file.path.startsWith("assets/") && !HASHED_NAME.test(file.path))
        problems.push(
          `${file.path}: an immutable asset must carry a content hash in its name`,
        );
      return {
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
        contentType: response.contentType,
        cacheControl: response.cacheControl,
      };
    });
  return {
    schema: STAGE_SCHEMA,
    inert: true,
    note: "Local staging only. No host, account, credential, upload or network access is involved or implied; an approval, rights or hosting decision is not made here.",
    https,
    publicRelease: publicRelease ?? {
      allowed: false,
      blockers: ["no provenance verdict"],
    },
    headersForEveryResponse: securityHeaders({ https }),
    files: planned,
    problems,
  };
}

// ---- paths ---------------------------------------------------------------------------------------------------------------

/** The OS's own real path (resolves links, junctions, case and short names). */
const realpathNative = (path) =>
  new Promise((done, fail) =>
    realpathCallback.native(path, (error, real) =>
      error ? fail(error) : done(real),
    ),
  );
const fold = (path) => path.normalize("NFC").toLowerCase();
const related = (a, b) => {
  const [fa, fb] = [fold(a), fold(b)];
  return fa === fb || fa.startsWith(fb + sep) || fb.startsWith(fa + sep);
};

/** The real path of `path` through its deepest existing ancestor (the path itself may not exist yet). */
async function realish(path) {
  let current = resolve(path);
  const rest = [];
  for (;;) {
    try {
      return join(await realpathNative(current), ...rest.reverse());
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      rest.push(basename(current));
      current = parent;
    }
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Refuses a target that exists, overlaps the artifact in any real or case-folded form, or passes through a link. */
async function checkTarget(dist, out) {
  if (await exists(out))
    throw new Error(
      `The staging target ${out} already exists; choose a new directory (this tool never replaces or merges one).`,
    );
  const [realDist, realOut] = await Promise.all([realish(dist), realish(out)]);
  if (related(dist, out) || related(realDist, realOut))
    throw new Error(
      "The staging directory must be separate from the artifact (no ancestor, descendant or case-equivalent path).",
    );
  if (fold(realOut) !== fold(resolve(out)))
    throw new Error(
      "The staging path passes through a symbolic link, junction or alias; use its real location.",
    );
}

/** Every regular file of the artifact, refusing links, special files, reserved hosting names and case collisions. */
async function scanSource(dist) {
  const root = await lstat(dist);
  if (root.isSymbolicLink() || !root.isDirectory())
    throw new Error(
      "The artifact directory must be a real directory, not a link.",
    );
  const found = [];
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir)) {
      const full = join(dir, entry);
      const path = prefix ? `${prefix}/${entry}` : entry;
      const info = await lstat(full);
      if (info.isSymbolicLink())
        throw new Error(`The artifact contains a link or junction: ${path}`);
      if (info.isDirectory()) await walk(full, path);
      else if (info.isFile()) found.push(path);
      else throw new Error(`The artifact contains a special file: ${path}`);
    }
  }
  await walk(dist, "");
  const seen = new Map();
  for (const path of found) {
    const key = fold(path);
    if (seen.has(key))
      throw new Error(
        `Case-equivalent artifact paths would collide on a case-insensitive host: ${seen.get(key)} and ${path}`,
      );
    seen.set(key, path);
    if (
      PREVIEW_CONTROL_FILES.includes(key) ||
      key.startsWith("_worker.js/") ||
      WRAPPER_FILES.includes(key)
    )
      throw new Error(
        `The artifact contains ${path}, which collides with a hosting control file this tool writes or reserves.`,
      );
  }
  return found;
}

// ---- the worker ------------------------------------------------------------------------------------------------------------

/** Strips only `export const` and `export function` prefixes, and refuses any other export form in the inlined text. */
function inline(source, name) {
  const text = source.replace(/^export (const|function) /gm, "$1 ");
  if (/^\s*export\b/m.test(text) || /^\s*import\b/m.test(text))
    throw new Error(
      `${name} has a module form that cannot be inlined into the worker.`,
    );
  return text;
}

/**
 * One self-contained module: the verbatim text of hosting/headers.mjs, the adapter, the audited original file inventory, and
 * the Pages entry point. Tests import this very text, not only the adapter module.
 */
export function buildWorkerSource({ headersSource, adapterSource, inventory }) {
  return [
    "// Generated by tools/lib/stage-hosting.mjs. INERT preparation: not deployed, not a selected host.",
    "// Section 1: hosting/headers.mjs, verbatim except that `export ` prefixes are removed.",
    inline(headersSource, "hosting/headers.mjs"),
    "// Section 2: hosting/preview-adapter.mjs, verbatim except that `export ` prefixes are removed.",
    inline(adapterSource, "hosting/preview-adapter.mjs"),
    "// Section 3: the audited original file inventory and the Pages advanced-mode entry point.",
    `const PREVIEW_INVENTORY = ${JSON.stringify([...inventory].sort())};`,
    "const serving = createPreviewHandler({",
    "  inventory: PREVIEW_INVENTORY,",
    "  policy: { securityHeaders, cacheControlFor, mimeTypes },",
    "});",
    "export default {",
    "  async fetch(request, env) {",
    "    return serving(request, env);",
    "  },",
    "};",
    "",
  ].join("\n");
}

const ROUTES = JSON.stringify(
  { version: 1, include: ["/*"], exclude: [] },
  null,
  2,
);

// ---- staging ---------------------------------------------------------------------------------------------------------------

async function sourceInventory(dist) {
  const files = await artifactFiles(dist);
  const provenanceBytes = await readFile(join(dist, "provenance.json"));
  return {
    files,
    filesSha256: filesDigest(files),
    provenance: {
      sha256: sha256(provenanceBytes),
      bytes: provenanceBytes.length,
    },
  };
}
const sameInventory = (a, b) =>
  a.filesSha256 === b.filesSha256 &&
  a.provenance.sha256 === b.provenance.sha256 &&
  JSON.stringify(a.files) === JSON.stringify(b.files);

async function stagedOriginals(site, wrapperPaths) {
  const present = [];
  async function walk(dir, prefix) {
    for (const entry of await readdir(dir)) {
      const full = join(dir, entry);
      const path = prefix ? `${prefix}/${entry}` : entry;
      const info = await lstat(full);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
        throw new Error(
          `The staged site contains a link or special file: ${path}`,
        );
      if (info.isDirectory()) await walk(full, path);
      else present.push(path);
    }
  }
  await walk(site, "");
  const originals = [];
  let provenance = null;
  for (const path of present.sort()) {
    if (wrapperPaths.includes(path)) continue;
    const bytes = await readFile(join(site, ...path.split("/")));
    if (path === "provenance.json")
      provenance = { sha256: sha256(bytes), bytes: bytes.length };
    else originals.push({ path, sha256: sha256(bytes), bytes: bytes.length });
  }
  return { originals, provenance };
}

/**
 * Verifies the artifact, plans staging and writes `<outDir>/site` (the exact original bytes plus the wrapper) with three
 * manifests beside it: `original-audit.json`, `hosting-manifest.json` and `stage-manifest.json`. The target must not exist.
 * Original bytes and provenance.json are hashed before copying, again after, and again in the staged tree; the wrapper has
 * its own inventory. A partial target this call created is removed on failure.
 */
export async function stageSite({
  distDir,
  outDir,
  https = true,
  requirePublic = false,
  paths = {},
  source,
  hooks = {},
} = {}) {
  const dist = resolve(distDir);
  const out = resolve(outDir);
  await checkTarget(dist, out);
  await scanSource(dist);
  const provenance = await verifyProvenance({
    requirePublic,
    paths: { ...paths, distDir: dist },
    source,
  });
  const before = await sourceInventory(dist);
  if (before.filesSha256 !== provenance.filesSha256)
    throw new Error(
      "The artifact inventory does not match its recorded provenance digest.",
    );
  const plan = planStaging({
    files: before.files,
    publicRelease: provenance.publicRelease,
    https,
  });
  if (plan.problems.length)
    throw new Error("Staging refused: " + plan.problems.join("; "));
  const headersSource = await readFile(HEADERS_SOURCE, "utf8");
  const adapterSource = await readFile(ADAPTER_SOURCE, "utf8");
  const worker = buildWorkerSource({
    headersSource,
    adapterSource,
    inventory: before.files.map((file) => file.path).concat("provenance.json"),
  });

  await mkdir(dirname(out), { recursive: true });
  await checkTarget(dist, out);
  await mkdir(out);
  try {
    const site = join(out, "site");
    await mkdir(site);
    const write = async (path, bytes) => {
      const target = join(site, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
      if (sha256(await readFile(target)) !== sha256(bytes))
        throw new Error(`Staged bytes differ from what was written: ${path}`);
    };
    for (const file of before.files) {
      const bytes = await readFile(join(dist, ...file.path.split("/")));
      if (sha256(bytes) !== file.sha256)
        throw new Error(
          `The artifact changed while it was being copied: ${file.path}`,
        );
      await write(file.path, bytes);
    }
    const provenanceBytes = await readFile(join(dist, "provenance.json"));
    if (sha256(provenanceBytes) !== before.provenance.sha256)
      throw new Error(
        "provenance.json changed while the artifact was being copied.",
      );
    await write("provenance.json", provenanceBytes);
    // A test seam: lets a control change the source or the staged copy at the one moment the post-copy audits must notice.
    await hooks.afterCopy?.({ dist, site });

    // The original audit is complete before any wrapper file exists.
    await scanSource(dist);
    const after = await sourceInventory(dist);
    if (!sameInventory(before, after))
      throw new Error(
        "The artifact changed during staging (inventory or provenance hash differs).",
      );
    await verifyProvenance({
      requirePublic,
      paths: { ...paths, distDir: dist },
      source,
    });
    const staged = await stagedOriginals(site, []);
    if (
      JSON.stringify(staged.originals) !== JSON.stringify(before.files) ||
      staged.provenance?.sha256 !== before.provenance.sha256
    )
      throw new Error(
        "The staged original files do not match the audited artifact.",
      );

    await write("_worker.js", worker);
    await write("_routes.json", ROUTES + "\n");
    const wrapperFiles = [];
    for (const path of WRAPPER_FILES) {
      const bytes = await readFile(join(site, path));
      wrapperFiles.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const originalAudit = {
      schema: ORIGINAL_AUDIT_SCHEMA,
      note: "The audited ORIGINAL artifact only. The wrapper files are audited separately in hosting-manifest.json and are not part of the original build.",
      sourceDir: await realish(dist),
      provenance: {
        ...before.provenance,
        recordedFilesSha256: provenance.filesSha256,
        source: provenance.source,
        publicRelease: provenance.publicRelease,
      },
      filesSha256: before.filesSha256,
      files: before.files,
      checks: {
        preCopyProvenanceVerified: true,
        sourceUnchangedAfterCopy: true,
        stagedMatchesSource: true,
      },
    };
    const hostingManifest = {
      schema: HOSTING_SCHEMA,
      inert: true,
      note: "Wrapper files for an optional Cloudflare Pages advanced-mode preview. No host, account, origin, credential, upload, terms or cost is chosen or implied. A Function answers every request (the _routes.json includes everything on purpose: excluding assets would let the platform's own fallback return HTML for a missing module or data file), so Function invocations are what count against any plan allowance; no plan, billing or traffic is assumed.",
      adapter: {
        kind: "cloudflare-pages-advanced-mode",
        binding: "ASSETS",
        https,
      },
      policySources: {
        "webApp/hosting/headers.mjs": { sha256: sha256(headersSource) },
        "webApp/hosting/preview-adapter.mjs": {
          sha256: sha256(adapterSource),
        },
      },
      reserved: {
        namespaces: PREVIEW_RESERVED_NAMESPACES,
        controlFiles: PREVIEW_CONTROL_FILES,
      },
      inventoryPaths: before.files.length + 1,
      files: wrapperFiles,
    };
    const originalText = JSON.stringify(originalAudit, null, 2) + "\n";
    const hostingText = JSON.stringify(hostingManifest, null, 2) + "\n";
    plan.files.push({
      path: "provenance.json",
      bytes: before.provenance.bytes,
      sha256: before.provenance.sha256,
      contentType: mimeTypes[".json"],
      cacheControl: cacheControlFor("/provenance.json"),
    });
    plan.manifests = {
      "original-audit.json": { sha256: sha256(originalText) },
      "hosting-manifest.json": { sha256: sha256(hostingText) },
    };
    await writeFile(join(out, "original-audit.json"), originalText, {
      flag: "wx",
    });
    await writeFile(join(out, "hosting-manifest.json"), hostingText, {
      flag: "wx",
    });
    await writeFile(
      join(out, "stage-manifest.json"),
      JSON.stringify(plan, null, 2) + "\n",
      { flag: "wx" },
    );
    const audits = await auditStage(out);
    for (const [name, audit] of Object.entries(audits))
      if (!audit.ok)
        throw new Error(
          `The staged ${name} audit failed: ${audit.problems.join("; ")}`,
        );
    return { plan, outDir: out, audits };
  } catch (error) {
    // Only a directory this call just created is removed; a target that already existed was refused above.
    const info = await lstat(out).catch(() => null);
    if (info?.isDirectory() && !info.isSymbolicLink())
      await rm(out, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Audits a staging directory WITHOUT running the artifact's provenance verification on the merged tree (the wrapper files are
 * not original artifacts). Three separate verdicts: the original files and provenance.json, the wrapper files, and the
 * manifests that bind them. Corrupting a wrapper file fails only `wrapper`; corrupting an original fails only `original`.
 */
export async function auditStage(outDir) {
  const out = resolve(outDir);
  const result = {
    original: { ok: true, problems: [] },
    wrapper: { ok: true, problems: [] },
    manifests: { ok: true, problems: [] },
  };
  const fail = (part, problem) => {
    result[part].ok = false;
    result[part].problems.push(problem);
  };
  const read = async (name) => {
    try {
      return await readFile(join(out, name), "utf8");
    } catch {
      fail("manifests", `${name} is missing`);
      return null;
    }
  };
  const [stageText, originalText, hostingText] = [
    await read("stage-manifest.json"),
    await read("original-audit.json"),
    await read("hosting-manifest.json"),
  ];
  if (stageText === null || originalText === null || hostingText === null)
    return result;
  const stage = JSON.parse(stageText);
  const original = JSON.parse(originalText);
  const hosting = JSON.parse(hostingText);
  if (stage.manifests?.["original-audit.json"]?.sha256 !== sha256(originalText))
    fail(
      "manifests",
      "original-audit.json differs from the hash recorded in stage-manifest.json",
    );
  if (
    stage.manifests?.["hosting-manifest.json"]?.sha256 !== sha256(hostingText)
  )
    fail(
      "manifests",
      "hosting-manifest.json differs from the hash recorded in stage-manifest.json",
    );
  if (
    original.schema !== ORIGINAL_AUDIT_SCHEMA ||
    hosting.schema !== HOSTING_SCHEMA
  )
    fail("manifests", "an unknown manifest schema");
  const site = join(out, "site");
  const wrapperPaths = hosting.files.map((file) => file.path);
  let staged;
  try {
    staged = await stagedOriginals(site, wrapperPaths);
  } catch (error) {
    fail("original", error.message);
    return result;
  }
  const byPath = new Map(staged.originals.map((file) => [file.path, file]));
  for (const file of original.files) {
    const have = byPath.get(file.path);
    if (!have) fail("original", `missing original file ${file.path}`);
    else if (have.sha256 !== file.sha256 || have.bytes !== file.bytes)
      fail("original", `modified original file ${file.path}`);
    byPath.delete(file.path);
  }
  for (const path of byPath.keys()) fail("original", `unexpected file ${path}`);
  if (staged.provenance?.sha256 !== original.provenance.sha256)
    fail("original", "provenance.json differs from the audited original");
  if (filesDigest(original.files) !== original.filesSha256)
    fail("original", "the audited inventory does not match its own digest");
  if (original.filesSha256 !== original.provenance.recordedFilesSha256)
    fail(
      "original",
      "the audited inventory differs from the digest recorded in provenance.json",
    );
  for (const file of hosting.files) {
    let bytes;
    try {
      bytes = await readFile(join(site, file.path));
    } catch {
      fail("wrapper", `missing wrapper file ${file.path}`);
      continue;
    }
    if (sha256(bytes) !== file.sha256 || bytes.length !== file.bytes)
      fail("wrapper", `modified wrapper file ${file.path}`);
  }
  try {
    const worker = await readFile(join(site, "_worker.js"), "utf8");
    const line = worker.match(/^const PREVIEW_INVENTORY = (\[.*\]);$/m);
    const embedded = line ? JSON.parse(line[1]) : null;
    const expected = original.files
      .map((file) => file.path)
      .concat("provenance.json")
      .sort();
    if (JSON.stringify(embedded) !== JSON.stringify(expected))
      fail(
        "wrapper",
        "the worker's file inventory differs from the audited original files",
      );
  } catch {
    // a missing or unreadable worker was already reported above
  }
  return result;
}
