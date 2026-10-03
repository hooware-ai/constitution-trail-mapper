import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer, get } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCore } from "../../tools/build-core.mjs";
import {
  sha256,
  verifyCoreManifest,
  writeCoreManifest,
  gradleInvocation,
} from "../../tools/lib/core.mjs";
import {
  sourceState,
  verifyProvenance,
  writeProvenance,
} from "../../tools/lib/provenance.mjs";

// --- fake repository with a fake core, so no Gradle is needed -----------------------------------------------------

async function fakeRepo() {
  const root = await mkdtemp(join(tmpdir(), "trail-release-"));
  for (const dir of [
    "sharedLogic/src",
    "webBridge/src",
    "out",
    "dist/assets",
    "release",
  ])
    await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, "sharedLogic/src/A.kt"), "class A\n");
  await writeFile(join(root, "webBridge/src/B.kt"), "class B\n");
  await writeFile(join(root, "out/TrailMapper-webBridge.mjs"), "export {};\n");
  await writeFile(join(root, "dist/index.html"), "<html></html>\n");
  await writeFile(join(root, "dist/assets/data.json"), '{"trails":[]}\n');
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
  return { root, core, paths };
}
const clean = { commit: "a".repeat(40), branch: "main", dirty: false };
const fixture = {
  schema: 1,
  kind: "fixture",
  id: "fx",
  version: "1",
  approved: false,
  license: "CC0-1.0",
};
async function approvedDataset(root: string) {
  const bytes = await readFile(join(root, "dist/assets/data.json"));
  const composition = {
    networkSha256: sha256(bytes),
    layerCounts: { "8": 0 },
    accessBaseSha256: null,
    accessIndexSha256: null,
    accessCombinedSha256: null,
    accessSourceInputSha256: null,
    accessSourceManifestSha256: null,
    supplementManifestSha256: null,
    proposedManifestSha256: null,
  };
  return {
    composition,
    approvedComposition: composition,
    schema: 1,
    kind: "county",
    id: "county",
    version: "2026-10",
    approved: true,
    content: { sha256: sha256(bytes), distPath: "assets/data.json" },
    sourceManifestSha256: "c".repeat(64),
    licenseEvidence: ["https://example.test/license"],
    attribution: "Trail data: example",
    approvedBy: "owner",
    approvedOn: "2026-10-01",
    license: "CC-BY-4.0",
  };
}
const edit = async (file: string, change: (json: any) => void) => {
  const json = JSON.parse(await readFile(file, "utf8"));
  change(json);
  await writeFile(file, JSON.stringify(json, null, 2));
};

// --- #2: public eligibility is recomputed, never trusted ---------------------------------------------------------

test("a fixture artifact is rejected for public release even when provenance is edited to say allowed", async () => {
  const { root, paths } = await fakeRepo();
  try {
    await writeFile(paths.datasetFile, JSON.stringify(fixture));
    await writeProvenance({ paths, source: clean });
    await verifyProvenance({ paths });
    await assert.rejects(
      verifyProvenance({ paths, requirePublic: true, source: clean }),
      /not publishable.*synthetic fixture/,
    );
    await edit(join(paths.distDir, "provenance.json"), (p) => {
      p.publicRelease = { allowed: true, blockers: [] };
    });
    await assert.rejects(
      verifyProvenance({ paths, requirePublic: true, source: clean }),
      /verdict is inconsistent/,
    );
    await assert.rejects(
      verifyProvenance({ paths }),
      /verdict is inconsistent/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("editing the dataset record to approved does not approve an unchanged fixture or hide the change", async () => {
  const { root, paths } = await fakeRepo();
  try {
    await writeFile(paths.datasetFile, JSON.stringify(fixture));
    await writeProvenance({ paths, source: clean });
    await writeFile(
      paths.datasetFile,
      JSON.stringify({ ...fixture, approved: true }),
    );
    await assert.rejects(verifyProvenance({ paths }), /dataset identity/);
    // Even re-recorded, a fixture cannot be approved.
    await writeProvenance({ paths, source: clean });
    await assert.rejects(
      verifyProvenance({ paths, requirePublic: true, source: clean }),
      /fixture dataset cannot be marked approved/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a complete approved dataset is releasable only on the recorded clean commit with its content in the artifact", async () => {
  const { root, paths } = await fakeRepo();
  try {
    await writeFile(
      paths.datasetFile,
      JSON.stringify(await approvedDataset(root)),
    );
    const written = await writeProvenance({ paths, source: clean });
    assert.equal(written.publicRelease.allowed, true);
    await verifyProvenance({ paths, requirePublic: true, source: clean });
    // A different commit than the one recorded.
    await assert.rejects(
      verifyProvenance({
        paths,
        requirePublic: true,
        source: { ...clean, commit: "b".repeat(40) },
      }),
      /different commit/,
    );
    // A dirty tree now.
    await assert.rejects(
      verifyProvenance({
        paths,
        requirePublic: true,
        source: { ...clean, dirty: true },
      }),
      /uncommitted or untracked/,
    );
    // Shipped content changed after approval: the file hash and the declared hash disagree.
    await writeFile(
      join(paths.distDir, "assets/data.json"),
      '{"trails":[1]}\n',
    );
    await assert.rejects(verifyProvenance({ paths }), /modified file/);
    await writeProvenance({ paths, source: clean });
    await assert.rejects(
      verifyProvenance({ paths, requirePublic: true, source: clean }),
      /does not match the declared hash/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("an approved dataset whose content is not in the artifact is rejected", async () => {
  const { root, paths } = await fakeRepo();
  try {
    const dataset = await approvedDataset(root);
    dataset.content.distPath = "assets/absent.json";
    await writeFile(paths.datasetFile, JSON.stringify(dataset));
    const written = await writeProvenance({ paths, source: clean });
    assert.equal(written.publicRelease.allowed, false);
    await assert.rejects(
      verifyProvenance({ paths, requirePublic: true, source: clean }),
      /is not in the artifact/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- #3: untracked, non-ignored files make the tree dirty; ignored output does not ------------------------------

test("an untracked source file is dirty, an ignored build output is not", async () => {
  const root = await mkdtemp(join(tmpdir(), "trail-git-"));
  try {
    const run = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
        {
          cwd: root,
          stdio: "pipe",
        },
      );
    run("init", "-q");
    await writeFile(join(root, ".gitignore"), "build/\n");
    await mkdir(join(root, "webBridge/src"), { recursive: true });
    await writeFile(join(root, "webBridge/src/A.kt"), "class A\n");
    run("add", "-A");
    run("commit", "-q", "-m", "init");
    assert.equal(sourceState(root).dirty, false);
    await mkdir(join(root, "build"), { recursive: true });
    await writeFile(join(root, "build/out.mjs"), "generated\n");
    assert.equal(sourceState(root).dirty, false);
    await writeFile(join(root, "webBridge/src/Extra.kt"), "class Extra\n");
    assert.equal(sourceState(root).dirty, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- #4: a source edit during the build cannot be certified ------------------------------------------------------

test("a source edit made while the core is building discards the output and the manifest", async () => {
  const { root, core } = await fakeRepo();
  try {
    await assert.rejects(
      buildCore({
        paths: core,
        run: async () => {
          // The fake compiler emits output, then the sources change before the build returns.
          await mkdir(core.outputDir, { recursive: true });
          await writeFile(
            join(core.outputDir, "TrailMapper-webBridge.mjs"),
            "export const v = 1;\n",
          );
          await writeFile(
            join(root, "webBridge/src/B.kt"),
            "class B { val edited = true }\n",
          );
        },
      }),
      /changed while the core was building/,
    );
    await assert.rejects(
      stat(join(core.outputDir, "TrailMapper-webBridge.mjs")),
    );
    await assert.rejects(stat(core.manifestPath));
    await assert.rejects(verifyCoreManifest(core), /No Kotlin core manifest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("an unchanged build records a manifest for exactly the inputs it started with", async () => {
  const { root, core } = await fakeRepo();
  try {
    const manifest = await buildCore({
      paths: core,
      run: async () => {
        await mkdir(core.outputDir, { recursive: true });
        await writeFile(
          join(core.outputDir, "TrailMapper-webBridge.mjs"),
          "export const v = 2;\n",
        );
      },
    });
    await verifyCoreManifest(core);
    assert.match(manifest.inputs.sha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("wrapper scripts, the wrapper jar and the Kotlin/JS lock are core inputs", async () => {
  const { root, core } = await fakeRepo();
  try {
    for (const [file, text] of [
      ["gradlew", "#!/bin/sh\n"],
      ["gradlew.bat", "@echo off\r\n"],
      ["kotlin-js-store/package-lock.json", "{}\n"],
    ] as const) {
      await mkdir(join(root, file, ".."), { recursive: true });
      await writeFile(join(root, file), text);
      await writeCoreManifest({}, core);
      await writeFile(join(root, file), text + "changed\n");
      await assert.rejects(verifyCoreManifest(core), /Stale Kotlin core/, file);
    }
    await mkdir(join(root, "gradle/wrapper"), { recursive: true });
    await writeFile(
      join(root, "gradle/wrapper/gradle-wrapper.jar"),
      Buffer.from([1, 2, 3]),
    );
    await writeCoreManifest({}, core);
    await writeFile(
      join(root, "gradle/wrapper/gradle-wrapper.jar"),
      Buffer.from([1, 2, 4]),
    );
    await assert.rejects(verifyCoreManifest(core), /Stale Kotlin core/);
    // CRLF checkouts of the shell wrapper hash the same as LF ones.
    await writeFile(join(root, "gradlew"), "#!/bin/sh\r\nexit 0\r\n");
    await writeCoreManifest({}, core);
    await writeFile(join(root, "gradlew"), "#!/bin/sh\nexit 0\n");
    await verifyCoreManifest(core);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- #1: the wrapper is run by sh on POSIX so a non-executable checkout works -------------------------------------

test("the Gradle wrapper is invoked through sh outside Windows and quoted through the shell on Windows", () => {
  const invocation = gradleInvocation([":x"]);
  if (process.platform === "win32") {
    assert.equal(invocation.shell, true);
    assert.match(invocation.command, /^".*gradlew\.bat"$/);
  } else {
    assert.equal(invocation.command, "sh");
    assert.match(invocation.args[0], /gradlew$/);
    assert.equal(invocation.shell, false);
  }
  assert.deepEqual(invocation.args.slice(-1), [":x"]);
});
test("the tracked Gradle wrapper carries the executable bit", () => {
  const listing = execFileSync("git", ["ls-files", "-s", "gradlew"], {
    cwd: join(process.cwd(), ".."),
    encoding: "utf8",
  });
  assert.match(listing, /^100755 /);
});

// --- #5: a malformed URL is a 400, not a dead server ---------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}
const request = (port: number, path: string) =>
  new Promise<number>((resolve, reject) => {
    // A raw request path so "/%" reaches the server unencoded.
    const req = get({ host: "127.0.0.1", port, path }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    req.on("error", reject);
  });
test("a malformed percent-escape returns 400 and the server keeps answering", async () => {
  const port = await freePort();
  const server = spawn(
    process.execPath,
    ["tools/serve-dist.mjs", "--port", String(port)],
    {
      cwd: process.cwd(),
      stdio: "ignore",
    },
  );
  try {
    let up = false;
    for (let attempt = 0; attempt < 50 && !up; attempt++) {
      try {
        await request(port, "/");
        up = true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(up, "server started");
    assert.equal(await request(port, "/%"), 400);
    assert.equal(await request(port, "/%E0%A4%A"), 400);
    // Still alive: a normal request gets a real HTTP answer (200 with a build, 404 without one).
    assert.ok([200, 404].includes(await request(port, "/")));
  } finally {
    server.kill();
  }
});
