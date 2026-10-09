import test from "node:test";
import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeCoreManifest } from "../../tools/lib/core.mjs";
import { writeProvenance } from "../../tools/lib/provenance.mjs";
import { cacheControlFor, securityHeaders } from "../../hosting/headers.mjs";
import {
  STAGE_SCHEMA,
  auditStage,
  planStaging,
  responseFor,
  stageSite,
} from "../../tools/lib/stage-hosting.mjs";

// A local fixture artifact (the synthetic fixture dataset) with a fake core: no Gradle, no server, no network, no account.
async function fixtureArtifact(extra: Record<string, string> = {}) {
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
  await writeFile(join(root, "dist/index.html"), "<html>shell</html>\n");
  await writeFile(
    join(root, "dist/assets/app.0123456789ab.js"),
    "export {};\n",
  );
  await writeFile(join(root, "dist/assets/app.0123456789ab.css"), "a{}\n");
  await writeFile(join(root, "dist/data/trails.0123456789ab.json"), "{}\n");
  await writeFile(join(root, "dist/data/notes.json"), "{}\n");
  for (const [path, text] of Object.entries(extra))
    await writeFile(join(root, "dist", path), text);
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
const cleanup = (root: string) => rm(root, { recursive: true, force: true });
const stage = (
  f: { root: string; paths: any; source: any },
  name = "stage",
  more: object = {},
) =>
  stageSite({
    distDir: f.paths.distDir,
    outDir: join(f.root, name),
    paths: f.paths,
    source: f.source,
    ...more,
  });
const missing = async (path: string) => assert.rejects(lstat(path), /ENOENT/);

test("every file gets the existing response policy: hashed assets immutable, entry points revalidated, HTTPS headers", async () => {
  const f = await fixtureArtifact();
  try {
    const { plan } = await stage(f);
    const byPath = Object.fromEntries(
      plan.files.map((file) => [file.path, file]),
    );
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
    assert.equal(plan.schema, STAGE_SCHEMA);
  } finally {
    await cleanup(f.root);
  }
});

test("staging copies the exact original bytes and adds the wrapper beside them, with separate audits that all pass", async () => {
  const f = await fixtureArtifact();
  try {
    const out = join(f.root, "stage");
    const { plan, audits } = await stage(f);
    assert.equal(plan.publicRelease.allowed, false);
    assert.ok(
      plan.publicRelease.blockers.some((b: string) =>
        /synthetic fixture/.test(b),
      ),
    );
    assert.deepEqual(
      Object.values(audits).map((a) => a.ok),
      [true, true, true],
    );
    const site = join(out, "site");
    for (const path of [
      "index.html",
      "assets/app.0123456789ab.js",
      "data/notes.json",
      "provenance.json",
    ])
      assert.deepEqual(
        await readFile(join(site, ...path.split("/"))),
        await readFile(join(f.paths.distDir, ...path.split("/"))),
        path,
      );
    assert.deepEqual((await readdir(site)).sort(), [
      "_routes.json",
      "_worker.js",
      "assets",
      "data",
      "index.html",
      "provenance.json",
    ]);
    const original = JSON.parse(
      await readFile(join(out, "original-audit.json"), "utf8"),
    );
    const hosting = JSON.parse(
      await readFile(join(out, "hosting-manifest.json"), "utf8"),
    );
    assert.ok(
      original.files.every((file: any) => !file.path.startsWith("_")),
      "wrappers are not part of the original inventory",
    );
    assert.deepEqual(
      hosting.files.map((file: any) => file.path),
      ["_worker.js", "_routes.json"],
    );
    assert.equal(
      JSON.parse(await readFile(join(site, "_routes.json"), "utf8")).include[0],
      "/*",
    );
    assert.equal(hosting.inert, true);
    assert.match(
      hosting.policySources["webApp/hosting/headers.mjs"].sha256,
      /^[0-9a-f]{64}$/,
    );
    // Staging twice gives byte-identical wrapper files and manifests.
    await stage(f, "stage-again");
    for (const name of [
      "site/_worker.js",
      "site/_routes.json",
      "hosting-manifest.json",
      "original-audit.json",
      "stage-manifest.json",
    ])
      assert.deepEqual(
        await readFile(join(f.root, "stage-again", name)),
        await readFile(join(out, name)),
        name,
      );
  } finally {
    await cleanup(f.root);
  }
});

test("the staged worker serves the staged site: shell navigation, real 404 for a missing module, exact bytes", async () => {
  const f = await fixtureArtifact();
  try {
    const out = join(f.root, "stage");
    await stage(f);
    const worker: any = await import(
      pathToFileURL(join(out, "site", "_worker.js")).href
    );
    const site = join(out, "site");
    const env = {
      ASSETS: {
        async fetch(request: Request) {
          const url = new URL(request.url);
          const name =
            url.pathname === "/" ? "index.html" : url.pathname.slice(1);
          try {
            const body = await readFile(join(site, ...name.split("/")));
            return new Response(request.method === "HEAD" ? null : body, {
              status: 200,
              headers: {
                "content-type": name.endsWith(".js")
                  ? "text/javascript"
                  : name.endsWith(".json")
                    ? "application/json"
                    : "text/html",
              },
            });
          } catch {
            return new Response("<html>fallback</html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            });
          }
        },
      },
    };
    const page = await worker.default.fetch(
      new Request("https://p.invalid/saved", {
        headers: { accept: "text/html" },
      }),
      env,
    );
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "<html>shell</html>\n");
    const module = await worker.default.fetch(
      new Request("https://p.invalid/assets/app.0123456789ab.js"),
      env,
    );
    assert.equal(await module.text(), "export {};\n");
    const gone = await worker.default.fetch(
      new Request("https://p.invalid/assets/other.js", {
        headers: { accept: "text/html" },
      }),
      env,
    );
    assert.equal(gone.status, 404);
    assert.match(gone.headers.get("content-type")!, /^text\/plain/);
  } finally {
    await cleanup(f.root);
  }
});

test("--public refuses an ineligible artifact before anything is written", async () => {
  const f = await fixtureArtifact();
  try {
    await assert.rejects(
      stage(f, "stage", { requirePublic: true }),
      /not publishable.*synthetic fixture/,
    );
    await missing(join(f.root, "stage"));
  } finally {
    await cleanup(f.root);
  }
});

test("an existing target is never replaced, merged or reused, even an empty one or one this tool wrote", async () => {
  const f = await fixtureArtifact();
  try {
    const empty = join(f.root, "empty");
    await mkdir(empty);
    await assert.rejects(stage(f, "empty"), /already exists/);
    assert.deepEqual(await readdir(empty), []);
    const foreign = join(f.root, "foreign");
    await mkdir(foreign);
    await writeFile(join(foreign, "keep.txt"), "mine");
    await assert.rejects(stage(f, "foreign"), /already exists/);
    assert.equal(await readFile(join(foreign, "keep.txt"), "utf8"), "mine");
    await stage(f, "marked");
    await writeFile(join(f.root, "marked", "site", "extra.txt"), "later");
    await assert.rejects(stage(f, "marked"), /already exists/);
    assert.equal(
      await readFile(join(f.root, "marked", "site", "extra.txt"), "utf8"),
      "later",
    );
    await writeFile(join(f.root, "afile"), "x");
    await assert.rejects(stage(f, "afile"), /already exists/);
  } finally {
    await cleanup(f.root);
  }
});

test("the target must not be the artifact, inside it, above it, or a case-equivalent spelling of any of those", async () => {
  const f = await fixtureArtifact();
  try {
    const dist = f.paths.distDir as string;
    for (const out of [
      dist,
      join(dist, "stage"),
      join(dist, "assets"),
      join(f.root),
      dist.toUpperCase(),
      join(dist.toUpperCase(), "inner"),
    ]) {
      await assert.rejects(
        stageSite({
          distDir: dist,
          outDir: out,
          paths: f.paths,
          source: f.source,
        }),
        /separate from the artifact|already exists/,
        out,
      );
    }
    await missing(join(dist, "stage"));
  } finally {
    await cleanup(f.root);
  }
});

async function link(target: string, path: string) {
  try {
    await symlink(target, path, "junction");
    return true;
  } catch {
    return false;
  }
}
test("a link or junction inside the artifact, as the artifact itself, or in the target's ancestry is refused", async (t) => {
  const f = await fixtureArtifact();
  try {
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret");
    if (!(await link(outside, join(f.paths.distDir, "data", "escape"))))
      return t.skip("links cannot be created here");
    await assert.rejects(stage(f), /link or junction: data\/escape/);
    await missing(join(f.root, "stage"));
    await rm(join(f.paths.distDir, "data", "escape"), {
      recursive: true,
      force: true,
    });
    // the artifact directory itself a link
    const alias = join(f.root, "dist-alias");
    assert.ok(await link(f.paths.distDir, alias));
    await assert.rejects(
      stageSite({
        distDir: alias,
        outDir: join(f.root, "stage2"),
        paths: f.paths,
        source: f.source,
      }),
      /not a link/,
    );
    // a link in the target's own ancestry
    const real = join(f.root, "real-parent");
    await mkdir(real);
    const viaLink = join(f.root, "via-link");
    assert.ok(await link(real, viaLink));
    await assert.rejects(
      stage(f, "via-link/stage"),
      /symbolic link, junction or alias|already exists|separate/,
    );
    assert.deepEqual(await readdir(real), []);
  } finally {
    await cleanup(f.root);
  }
});

test("an artifact file that collides with a hosting control name, in any case, is refused", async () => {
  for (const name of [
    "_worker.js",
    "_Headers",
    "_ROUTES.JSON",
    "stage-manifest.json",
    "Hosting-Manifest.json",
    "original-audit.json",
    "_redirects",
  ]) {
    const f = await fixtureArtifact({ [name]: "x" });
    try {
      await assert.rejects(
        stage(f),
        /collides with a hosting control file/,
        name,
      );
      await missing(join(f.root, "stage"));
    } finally {
      await cleanup(f.root);
    }
  }
});

test("case-equivalent artifact paths are refused because they would collide on a case-insensitive host", async (t) => {
  const f = await fixtureArtifact({ "data/Dup.json": "{}\n" });
  try {
    await writeFile(join(f.paths.distDir, "data", "DUP.json"), "{}\n");
    const names = (await readdir(join(f.paths.distDir, "data"))).filter(
      (n: string) => n.toLowerCase() === "dup.json",
    );
    if (names.length < 2) return t.skip("this file system is case-insensitive");
    await assert.rejects(stage(f), /Case-equivalent/);
  } finally {
    await cleanup(f.root);
  }
});

test("a source change during the copy, a changed provenance.json, or a changed staged copy fails the audit and leaves no target", async () => {
  for (const [name, hooks, pattern] of [
    [
      "original byte changed after copy",
      {
        afterCopy: async ({ dist }: any) =>
          writeFile(join(dist, "index.html"), "<html>changed</html>\n"),
      },
      /changed during staging/,
    ],
    [
      "provenance.json changed after copy",
      {
        afterCopy: async ({ dist }: any) =>
          writeFile(join(dist, "provenance.json"), "{}\n"),
      },
      /changed during staging|Provenance check failed/,
    ],
    [
      "file added to the source after copy",
      {
        afterCopy: async ({ dist }: any) =>
          writeFile(join(dist, "data", "late.json"), "{}\n"),
      },
      /changed during staging/,
    ],
    [
      "staged original changed after copy",
      {
        afterCopy: async ({ site }: any) =>
          writeFile(join(site, "index.html"), "<html>tampered</html>\n"),
      },
      /do not match the audited artifact/,
    ],
    [
      "staged provenance.json changed after copy",
      {
        afterCopy: async ({ site }: any) =>
          writeFile(join(site, "provenance.json"), "{}\n"),
      },
      /do not match the audited artifact/,
    ],
  ] as [string, any, RegExp][]) {
    const f = await fixtureArtifact();
    try {
      await assert.rejects(stage(f, "stage", { hooks }), pattern, name);
      await missing(join(f.root, "stage"));
    } finally {
      await cleanup(f.root);
    }
  }
});

test("a modified or falsely described artifact is refused before any copy", async () => {
  const f = await fixtureArtifact();
  try {
    await writeFile(
      join(f.paths.distDir, "index.html"),
      "<html>changed</html>\n",
    );
    await assert.rejects(stage(f), /modified file index\.html/);
    await missing(join(f.root, "stage"));
  } finally {
    await cleanup(f.root);
  }
});

test("original and wrapper audits are independent: each corruption fails only its own verdict", async () => {
  type Expect = { original: boolean; wrapper: boolean; manifests: boolean };
  const cases: [string, (out: string) => Promise<void>, Expect][] = [
    [
      "wrapper bytes changed",
      (o) => writeFile(join(o, "site", "_worker.js"), "export default {};\n"),
      { original: true, wrapper: false, manifests: true },
    ],
    [
      "wrapper removed",
      (o) => rm(join(o, "site", "_routes.json")),
      { original: true, wrapper: false, manifests: true },
    ],
    [
      "original bytes changed",
      (o) =>
        writeFile(
          join(o, "site", "assets", "app.0123456789ab.js"),
          "alert(1)\n",
        ),
      { original: false, wrapper: true, manifests: true },
    ],
    [
      "original removed",
      (o) => rm(join(o, "site", "data", "notes.json")),
      { original: false, wrapper: true, manifests: true },
    ],
    [
      "provenance.json changed",
      (o) => writeFile(join(o, "site", "provenance.json"), "{}\n"),
      { original: false, wrapper: true, manifests: true },
    ],
    [
      "unexpected file added",
      (o) => writeFile(join(o, "site", "extra.html"), "x"),
      { original: false, wrapper: true, manifests: true },
    ],
    [
      "audit record edited (it is the base both inventories are checked against, so every verdict fails)",
      (o) =>
        writeFile(
          join(o, "original-audit.json"),
          '{"schema":"trail-mapper.stage-original-audit/1","files":[],"provenance":{}}\n',
        ),
      { original: false, wrapper: false, manifests: false },
    ],
    [
      "hosting record edited",
      async (o) =>
        writeFile(
          join(o, "hosting-manifest.json"),
          (await readFile(join(o, "hosting-manifest.json"), "utf8")).replace(
            "preview",
            "prev1ew",
          ),
        ),
      { original: true, wrapper: true, manifests: false },
    ],
  ];
  for (const [name, corrupt, expected] of cases) {
    const f = await fixtureArtifact();
    try {
      const out = join(f.root, "stage");
      await stage(f);
      assert.deepEqual(
        Object.values(await auditStage(out)).map((a) => a.ok),
        [true, true, true],
        `${name}: clean first`,
      );
      await corrupt(out);
      const audits = await auditStage(out);
      assert.equal(
        audits.original.ok,
        expected.original,
        `${name}: original ${audits.original.problems.join("; ")}`,
      );
      assert.equal(
        audits.wrapper.ok,
        expected.wrapper,
        `${name}: wrapper ${audits.wrapper.problems.join("; ")}`,
      );
      assert.equal(
        audits.manifests.ok,
        expected.manifests,
        `${name}: manifests ${audits.manifests.problems.join("; ")}`,
      );
    } finally {
      await cleanup(f.root);
    }
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
      // the Pages entry point it writes into the worker text is the one place the word appears
      .filter((line) => !/async fetch\(request, env\)/.test(line))
      .join("\n");
    for (const forbidden of [
      /\bfetch\b/,
      /node:https?\b/,
      /node:net\b/,
      /node:child_process/,
      /XMLHttpRequest/,
      /process\.env/,
      /firebase|api[_-]?key|\bsecret|password|bearer/i,
      /wrangler|\bdeploy\b|\bupload\(/i,
    ])
      assert.doesNotMatch(source, forbidden, `${file} ${forbidden}`);
  }
});

test("the stage manifest must agree with the audited original: a flipped verdict, policy or file entry fails the manifests verdict only", async () => {
  const edits: [string, (stage: any) => void][] = [
    ["release verdict flipped", (m) => (m.publicRelease.allowed = true)],
    ["blockers removed", (m) => (m.publicRelease.blockers = [])],
    [
      "cache policy changed",
      (m) => (m.files[0].cacheControl = "public, max-age=1"),
    ],
    ["file hash changed", (m) => (m.files[1].sha256 = "0".repeat(64))],
    ["file entry removed", (m) => m.files.pop()],
    [
      "header policy changed",
      (m) =>
        (m.headersForEveryResponse["Content-Security-Policy"] =
          "default-src *"),
    ],
    ["https flag changed", (m) => (m.https = false)],
    ["unknown schema", (m) => (m.schema = "x")],
  ];
  for (const [name, edit] of edits) {
    const f = await fixtureArtifact();
    try {
      const out = join(f.root, "stage");
      await stage(f);
      assert.deepEqual(
        Object.values(await auditStage(out)).map((a) => a.ok),
        [true, true, true],
      );
      const file = join(out, "stage-manifest.json");
      const manifest = JSON.parse(await readFile(file, "utf8"));
      edit(manifest);
      await writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
      const audits = await auditStage(out);
      assert.equal(audits.manifests.ok, false, name);
      assert.equal(audits.original.ok, true, `${name} original`);
      assert.equal(audits.wrapper.ok, true, `${name} wrapper`);
    } finally {
      await cleanup(f.root);
    }
  }
});

test("Vite-style dash-separated content hashes count as hashed; names with no hash still do not", () => {
  const ok = planStaging({
    files: [
      { path: "assets/index-D31K2X3c.js", bytes: 1, sha256: "a" },
      { path: "assets/worker-DLY2vXrn.js", bytes: 1, sha256: "b" },
      { path: "assets/index-BlRAjpK_.css", bytes: 1, sha256: "c" },
    ],
  });
  assert.deepEqual(ok.problems, []);
  const bad = planStaging({
    files: [
      { path: "assets/index.js", bytes: 1, sha256: "a" },
      { path: "assets/app-short.js", bytes: 1, sha256: "b" },
    ],
  });
  assert.equal(bad.problems.length, 2);
});
