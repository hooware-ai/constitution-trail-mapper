import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageFromFiles } from "../../tools/lib/dataset-package.mjs";
import { makeCounty } from "../support/county-fixture.mjs";

const webRoot = process.cwd();

async function packaged() {
  const dir = await mkdtemp(join(tmpdir(), "trail-release-county-"));
  const county = makeCounty();
  const files = {
    input: join(dir, "extract.json"),
    manifest: join(dir, "manifest.json"),
    approval: join(dir, "approval.json"),
    out: join(dir, "county"),
  };
  await writeFile(files.input, JSON.stringify(county.input));
  await writeFile(files.manifest, JSON.stringify(county.manifest));
  await writeFile(files.approval, JSON.stringify(county.approval));
  const built = await packageFromFiles({
    inputFile: files.input,
    manifestPath: files.manifest,
    approvalPath: files.approval,
    outDir: files.out,
  });
  return { dir, files, built };
}
const verify = (env: Record<string, string>) =>
  // Exactly how tools/release.mjs starts it: the current node, no shell.
  spawnSync(process.execPath, ["tools/verify-county-package.mjs"], {
    cwd: webRoot,
    encoding: "utf8",
    shell: false,
    env: { ...process.env, ...env },
  });

test("the county release step runs without a shell and verifies a good package", async () => {
  const { dir, files } = await packaged();
  try {
    const result = verify({
      TRAIL_COUNTY_DIR: files.out,
      TRAIL_COUNTY_MANIFEST: files.manifest,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /County package verified: .* 5 features/);
    // The earlier inline `node -e` form left a stray file named "{" behind on Windows.
    await assert.rejects(stat(join(webRoot, "{")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the county release step fails with the reason and the fix when the package is missing or altered", async () => {
  const { dir, files, built } = await packaged();
  try {
    const missing = verify({
      TRAIL_COUNTY_DIR: join(dir, "absent"),
      TRAIL_COUNTY_MANIFEST: files.manifest,
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /npm run package:dataset/);
    const network = join(files.out, built.file);
    const original = await readFile(network, "utf8");
    await writeFile(network, original + " ");
    const altered = verify({
      TRAIL_COUNTY_DIR: files.out,
      TRAIL_COUNTY_MANIFEST: files.manifest,
    });
    assert.notEqual(altered.status, 0);
    assert.match(altered.stderr, /refused/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release.mjs starts every county step without passing JavaScript through a shell", async () => {
  const source = await readFile(join(webRoot, "tools", "release.mjs"), "utf8");
  assert.doesNotMatch(source, /"-e"|'-e'/);
  assert.match(source, /verify-county-package\.mjs/);
});
