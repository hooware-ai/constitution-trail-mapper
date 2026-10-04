// INERT hosting preparation: turns a verified build artifact into a local, provider-neutral staging directory and a manifest
// of exactly what any host must serve (every file with its size, hash, content type and response headers). It selects no
// host, reads no account or credential, opens no network connection and uploads nothing; it only reads the artifact and
// writes under a directory it is given. The response policy is the existing hosting/headers.mjs (also what serve-dist.mjs
// applies in tests), not a second copy of it.
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import {
  cacheControlFor,
  mimeTypes,
  securityHeaders,
} from "../../hosting/headers.mjs";
import { artifactFiles, verifyProvenance } from "./provenance.mjs";

export const STAGE_SCHEMA = "trail-mapper.stage/1";
const HASHED_NAME = /\.[0-9a-zA-Z_-]{8,}\.[a-z0-9]+$/;

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

/**
 * Verifies the artifact, plans staging and copies the exact files into `<outDir>/site`, with `stage-manifest.json` beside it.
 * With `requirePublic`, an artifact that is not eligible for public release is refused before anything is written.
 * `outDir` must not be inside the artifact, and an existing staging directory is replaced only if it is one this tool wrote.
 */
export async function stageSite({
  distDir,
  outDir,
  https = true,
  requirePublic = false,
  paths = {},
  source,
} = {}) {
  const dist = resolve(distDir);
  const out = resolve(outDir);
  if (out === dist || out.startsWith(dist + sep) || dist.startsWith(out + sep))
    throw new Error(
      "The staging directory must be separate from the artifact.",
    );
  const provenance = await verifyProvenance({
    requirePublic,
    paths: { ...paths, distDir: dist },
    source,
  });
  const files = await artifactFiles(dist);
  const plan = planStaging({
    files,
    publicRelease: provenance.publicRelease,
    https,
  });
  if (plan.problems.length)
    throw new Error("Staging refused: " + plan.problems.join("; "));
  let existing = [];
  try {
    existing = await readdir(out);
  } catch {
    // does not exist yet
  }
  if (existing.length) {
    const marker = await readFile(
      join(out, "stage-manifest.json"),
      "utf8",
    ).catch(() => "");
    if (!marker.includes(`"${STAGE_SCHEMA}"`))
      throw new Error(
        "The staging directory is not empty and was not written by this tool; refusing to replace it.",
      );
    await rm(out, { recursive: true, force: true });
  }
  await mkdir(join(out, "site"), { recursive: true });
  for (const file of plan.files) {
    const target = join(out, "site", ...file.path.split("/"));
    await mkdir(join(target, ".."), { recursive: true });
    await cp(join(dist, ...file.path.split("/")), target);
  }
  // provenance.json belongs to the artifact and is served with it; artifactFiles leaves it out of its own list.
  await cp(join(dist, "provenance.json"), join(out, "site", "provenance.json"));
  const provenanceBytes = await readFile(join(dist, "provenance.json"));
  plan.files.push({
    path: "provenance.json",
    bytes: provenanceBytes.length,
    sha256: createHash("sha256").update(provenanceBytes).digest("hex"),
    contentType: mimeTypes[".json"],
    cacheControl: cacheControlFor("/provenance.json"),
  });
  await writeFile(
    join(out, "stage-manifest.json"),
    JSON.stringify(plan, null, 2) + "\n",
  );
  return { plan, outDir: out };
}
