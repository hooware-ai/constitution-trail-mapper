import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  verifyAddressPackage,
  addressIndexBuildFile,
} from "../../tools/lib/address-package.mjs";

test("a public county build always includes its pinned address index and cannot silently disable it", () => {
  assert.equal(
    addressIndexBuildFile("/repo", "county", "public", undefined),
    "/repo/data/generated/web-address-index.json",
  );
  for (const override of ["", "/other/index.json"])
    assert.throws(
      () => addressIndexBuildFile("/repo", "county", "public", override),
      /cannot disable or replace/,
    );
  assert.equal(
    addressIndexBuildFile("/repo", "fixture", "review", undefined),
    undefined,
  );
  assert.equal(
    addressIndexBuildFile("/repo", "county", "review", "/review/index.json"),
    "/review/index.json",
  );
});

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "trail-address-pin-"));
  mkdirSync(join(root, "data/generated"), { recursive: true });
  const bytes = Buffer.from(
    JSON.stringify({ schema: "trail-mapper.address-index/1", num: [100, 200] }),
  );
  const file = join(root, "data/generated/web-address-index.json");
  const pin = {
    index: {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    transform: { report: { indexed: 2 } },
    source: {
      item: { licenseInfo: "https://creativecommons.org/licenses/by/4.0/" },
      completeness: {
        serviceCount: 2,
        fetchedRows: 2,
        distinctIds: 2,
        transferLimitHit: false,
      },
    },
  };
  const save = () =>
    writeFileSync(
      join(root, "data/web-address-index.manifest.json"),
      JSON.stringify(pin),
    );
  writeFileSync(file, bytes);
  save();
  try {
    run({ root, file, pin, save });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("address artifact checks exact bytes and rejects a substituted index", () =>
  fixture(({ root, file }) => {
    assert.equal(verifyAddressPackage(root).rows, 2);
    writeFileSync(
      file,
      '{"schema":"trail-mapper.address-index/1","num":[999]}',
    );
    assert.throws(
      () => verifyAddressPackage(root),
      /differs from the committed snapshot/,
    );
  }));
test("a pinned but truncated source cannot become a public address artifact", () =>
  fixture(({ root, pin, save }) => {
    pin.source.completeness.serviceCount = 3;
    save();
    assert.throws(
      () => verifyAddressPackage(root),
      /complete licensed snapshot/,
    );
  }));
test("missing package explains preparation and missing licence evidence fails closed", () =>
  fixture(({ root, file, pin, save }) => {
    pin.source.item.licenseInfo = "";
    save();
    assert.throws(
      () => verifyAddressPackage(root),
      /complete licensed snapshot/,
    );
    rmSync(file);
    assert.throws(() => verifyAddressPackage(root), /prepare:addresses/);
  }));
