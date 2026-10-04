import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCoreManifest } from "../../tools/lib/core.mjs";
import { writeProvenance } from "../../tools/lib/provenance.mjs";
import { cacheControlFor, securityHeaders } from "../../hosting/headers.mjs";
import {
  STAGE_SCHEMA,
  planStaging,
  responseFor,
  stageSite,
} from "../../tools/lib/stage-hosting.mjs";

// A local fixture artifact (the synthetic fixture dataset) with a fake core: no Gradle, no server, no network, no account.
async function fixtureArtifact() {
  const root = await mkdtemp(join(tmpdir(), "trail-stage-"));
  for (const dir of [
    "sharedLogic/src",
    "webBridge/src",
    "out",
    "dist/assets",
    "dist/data",
    "release",
  ])
    await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, "sharedLogic/src/A.kt"), "class A\n");
  await writeFile(join(root, "webBridge/src/B.kt"), "class B\n");
  await writeFile(join(root, "out/TrailMapper-webBridge.mjs"), "export {};\n");
  await writeFile(join(root, "dist/index.html"), "<html></html>\n");
  await writeFile(
    join(root, "dist/assets/app.0123456789ab.js"),
    "export {};\n",
  );
  await writeFile(join(root, "dist/assets/app.0123456789ab.css"), "a{}\n");
  await writeFile(join(root, "dist/data/trails.0123456789ab.json"), "{}\n");
  await writeFile(join(root, "dist/data/notes.json"), "{}\n");
  await writeFile(
    join(root, "release/dataset.json"),
    JSON.stringify({
      schema: 1,
      kind: "fixture",
      id: "fx",
      version: "1",
      approved: false,
      license: "CC0-1.0",
    }),
  );
  const core = {
    root,
    outputDir: join(root, "out"),
    manifestPath: join(root, "manifest.json"),
    distRoot: join(root, "out"),
  };
  await writeCoreManifest({}, core);
  const paths = {
    distDir: join(root, "dist"),
    datasetFile: join(root, "release/dataset.json"),
    webRoot: root,
    core,
  };
  const source = { commit: "a".repeat(40), branch: "main", dirty: false };
  await writeProvenance({ paths, source });
  return { root, paths, source };
}

test("every file gets the existing response policy: hashed assets immutable, entry points revalidated, HTTPS headers", async () => {
  const { root, paths, source } = await fixtureArtifact();
  try {
    const { plan } = await stageSite({
      distDir: paths.distDir,
      outDir: join(root, "stage"),
      paths,
      source,
    });
    const byPath = Object.fromEntries(plan.files.map((f) => [f.path, f]));
    assert.equal(
      byPath["assets/app.0123456789ab.js"].cacheControl,
      "public, max-age=31536000, immutable",
    );
    assert.equal(
      byPath["data/trails.0123456789ab.json"].cacheControl,
      "public, max-age=31536000, immutable",
    );
    for (const entry of ["index.html", "data/notes.json", "provenance.json"])
      assert.equal(byPath[entry].cacheControl, "no-cache", entry);
    assert.equal(byPath["index.html"].contentType, "text/html; charset=utf-8");
    assert.deepEqual(
      plan.headersForEveryResponse,
      securityHeaders({ https: true }),
    );
    assert.match(
      plan.headersForEveryResponse["Strict-Transport-Security"],
      /max-age=31536000/,
    );
    assert.equal(
      responseFor("index.html", { https: false }).headers[
        "Strict-Transport-Security"
      ],
      undefined,
    );
    assert.equal(
      cacheControlFor("/assets/x.0123456789ab.js"),
      byPath["assets/app.0123456789ab.js"].cacheControl,
    );
    assert.equal(plan.inert, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("staging copies exactly the verified bytes and writes a manifest that names them; the fixture is not publishable", async () => {
  const { root, paths, source } = await fixtureArtifact();
  try {
    const out = join(root, "stage");
    const { plan } = await stageSite({
      distDir: paths.distDir,
      outDir: out,
      paths,
      source,
    });
    assert.equal(plan.publicRelease.allowed, false);
    assert.ok(
      plan.publicRelease.blockers.some((b: string) =>
        /synthetic fixture/.test(b),
      ),
    );
    const manifest = JSON.parse(
      await readFile(join(out, "stage-manifest.json"), "utf8"),
    );
    assert.equal(manifest.schema, STAGE_SCHEMA);
    for (const file of manifest.files)
      assert.equal(
        (await readFile(join(out, "site", ...file.path.split("/")))).length,
        file.bytes,
        file.path,
      );
    assert.deepEqual((await readdir(join(out, "site"))).sort(), [
      "assets",
      "data",
      "index.html",
      "provenance.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--public refuses an ineligible artifact before anything is written", async () => {
  const { root, paths, source } = await fixtureArtifact();
  try {
    const out = join(root, "stage");
    await assert.rejects(
      stageSite({
        distDir: paths.distDir,
        outDir: out,
        requirePublic: true,
        paths,
        source,
      }),
      /not publishable.*synthetic fixture/,
    );
    await assert.rejects(readdir(out), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a modified artifact file is refused, the staging directory must be separate, and a foreign directory is never replaced", async () => {
  const { root, paths, source } = await fixtureArtifact();
  try {
    await assert.rejects(
      stageSite({
        distDir: paths.distDir,
        outDir: join(paths.distDir, "stage"),
        paths,
        source,
      }),
      /separate/,
    );
    const foreign = join(root, "foreign");
    await mkdir(foreign);
    await writeFile(join(foreign, "keep.txt"), "mine");
    await assert.rejects(
      stageSite({ distDir: paths.distDir, outDir: foreign, paths, source }),
      /not written by this tool/,
    );
    assert.equal(await readFile(join(foreign, "keep.txt"), "utf8"), "mine");
    await writeFile(
      join(paths.distDir, "index.html"),
      "<html>changed</html>\n",
    );
    await assert.rejects(
      stageSite({
        distDir: paths.distDir,
        outDir: join(root, "stage"),
        paths,
        source,
      }),
      /modified file index\.html/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a previous staging directory written by this tool is replaced, not merged", async () => {
  const { root, paths, source } = await fixtureArtifact();
  try {
    const out = join(root, "stage");
    await stageSite({ distDir: paths.distDir, outDir: out, paths, source });
    await writeFile(join(out, "site", "stale.txt"), "old");
    await stageSite({ distDir: paths.distDir, outDir: out, paths, source });
    assert.ok(!(await readdir(join(out, "site"))).includes("stale.txt"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the plan reports what a host cannot serve under the policy: unknown types and unhashed immutable assets", () => {
  const files = [
    { path: "assets/plain.js", bytes: 1, sha256: "a" },
    { path: "data/addresses.0123456789ab.bin", bytes: 1, sha256: "b" },
    { path: "index.html", bytes: 1, sha256: "c" },
  ];
  const plan = planStaging({ files });
  assert.equal(plan.publicRelease.allowed, false);
  assert.equal(plan.problems.length, 2);
  assert.match(
    plan.problems.join("\n"),
    /assets\/plain\.js: an immutable asset must carry a content hash/,
  );
  assert.match(
    plan.problems.join("\n"),
    /no content type is defined for \.bin/,
  );
});

test("the staging policy gap for a future hash-named data file is visible, not hidden", () => {
  // Only trails.<hash>.json is cached immutably today; any other data file (for example a later address index) would be
  // revalidated on every load until the existing policy is deliberately extended in its own reviewed change.
  assert.equal(
    cacheControlFor("/data/addresses.0123456789ab.json"),
    "no-cache",
  );
});

test("the stager is inert: no network, process, host or credential access in its code", () => {
  for (const file of [
    "../../tools/lib/stage-hosting.mjs",
    "../../tools/stage-hosting.mjs",
  ]) {
    const source = readFileSync(join(import.meta.dirname, file), "utf8")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    for (const forbidden of [
      /\bfetch\b/,
      /node:https?\b/,
      /node:net\b/,
      /node:child_process/,
      /XMLHttpRequest/,
      /process\.env/,
      /firebase|token|secret|password/i,
    ])
      assert.doesNotMatch(source, forbidden, `${file} ${forbidden}`);
  }
});
