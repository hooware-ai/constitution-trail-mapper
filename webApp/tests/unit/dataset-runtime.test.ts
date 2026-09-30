import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DatasetError,
  identityOf,
  parseDatasetRecord,
  verifyDatasetContent,
} from "../../src/dataset";
import { buildPackage } from "../../tools/lib/dataset-package.mjs";
import { makeCounty } from "../support/county-fixture.mjs";

async function packaged() {
  const county = makeCounty();
  const built = await buildPackage({
    inputText: JSON.stringify(county.input),
    manifest: county.manifest,
    manifestBytes: Buffer.from(JSON.stringify(county.manifest)),
    approval: county.approval,
  });
  const buffer = built.body.buffer.slice(
    built.body.byteOffset,
    built.body.byteOffset + built.body.byteLength,
  ) as ArrayBuffer;
  return { record: JSON.parse(JSON.stringify(built.record)), buffer };
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof DatasetError ? error.code : `other:${error}`;
  }
  return "none";
};

test("a packaged record is accepted in the review channel and identified by hash", async () => {
  const { record } = await packaged();
  const parsed = parseDatasetRecord(record, "review");
  assert.deepEqual(identityOf(parsed), {
    kind: "county",
    id: "synthetic-county",
    version: record.version,
    contentSha256: record.content.sha256,
  });
});
test("the public channel refuses data that is not approved, with a visible reason", async () => {
  const { record } = await packaged();
  assert.equal(
    code(() => parseDatasetRecord(record, "public")),
    "data-unapproved",
  );
  // An approval flag without a named approver and date is itself corrupt, never accepted.
  const claimed = {
    ...record,
    approval: { ...record.approval, approved: true },
  };
  assert.equal(
    code(() => parseDatasetRecord(claimed, "public")),
    "data-corrupt",
  );
  const named = {
    ...record,
    approval: {
      approved: true,
      approvedBy: "owner",
      approvedOn: "2026-10-01",
      blockers: [],
    },
  };
  assert.equal(
    code(() => parseDatasetRecord(named, "public")),
    "none",
  );
});
test("unknown schemas and formats are incompatible; missing or invalid fields are corrupt", async () => {
  const { record } = await packaged();
  const change = (mutate: (r: any) => void) => {
    const copy = JSON.parse(JSON.stringify(record));
    mutate(copy);
    return copy;
  };
  const expectations: Array<[string, any, string]> = [
    [
      "schema",
      change((r) => (r.schema = "trail-mapper.dataset/2")),
      "data-incompatible",
    ],
    [
      "content schema",
      change((r) => (r.content.schema = "trail-mapper.network/9")),
      "data-incompatible",
    ],
    ["not an object", "nope", "data-corrupt"],
    ["missing id", change((r) => delete r.id), "data-corrupt"],
    ["fixture kind", change((r) => (r.kind = "fixture")), "data-corrupt"],
    [
      "file traversal",
      change((r) => (r.content.file = "../evil.json")),
      "data-corrupt",
    ],
    [
      "file/hash mismatch",
      change((r) => (r.content.file = "trails.000000000000.json")),
      "data-corrupt",
    ],
    ["bad hash", change((r) => (r.content.sha256 = "xyz")), "data-corrupt"],
    [
      "zero features",
      change((r) => (r.content.featureCount = 0)),
      "data-corrupt",
    ],
    ["missing license", change((r) => delete r.source.license), "data-corrupt"],
    [
      "missing attribution",
      change((r) => delete r.source.attribution),
      "data-corrupt",
    ],
    [
      "missing change disclosure",
      change((r) => delete r.source.changes),
      "data-corrupt",
    ],
    ["missing approval", change((r) => delete r.approval), "data-corrupt"],
    ["omitted replaced by {}", change((r) => (r.omitted = {})), "data-corrupt"],
    [
      "omitted ids not numbers",
      change((r) => (r.omitted.proposedFeatureIds = ["x"])),
      "data-corrupt",
    ],
    [
      "omitted ids not a list",
      change((r) => (r.omitted.proposedFeatureIds = 5)),
      "data-corrupt",
    ],
    [
      "omitted supplements missing",
      change((r) => delete r.omitted.supplements),
      "data-corrupt",
    ],
    [
      "omitted access roads blank",
      change((r) => (r.omitted.accessRoads = " ")),
      "data-corrupt",
    ],
    [
      "blocker that is not a string",
      change((r) => (r.approval.blockers = [{ x: 1 }])),
      "data-corrupt",
    ],
    [
      "approver of the wrong type",
      change((r) => (r.approval.approvedBy = 7)),
      "data-corrupt",
    ],
  ];
  for (const [name, value, expected] of expectations)
    assert.equal(
      code(() => parseDatasetRecord(value, "review")),
      expected,
      name,
    );
});

test("content that matches its record is returned as text for the router", async () => {
  const { record, buffer } = await packaged();
  const text = await verifyDatasetContent(
    buffer,
    parseDatasetRecord(record, "review"),
  );
  assert.equal(JSON.parse(text).layers[0].features.length, 5);
});
test("truncated, altered, non-JSON and miscounted content is refused as corrupt", async () => {
  const { record, buffer } = await packaged();
  const parsed = parseDatasetRecord(record, "review");
  const reject = async (bytes: ArrayBuffer, r = parsed) => {
    try {
      await verifyDatasetContent(bytes, r);
    } catch (error) {
      return (error as DatasetError).code;
    }
    return "none";
  };
  assert.equal(
    await reject(buffer.slice(0, buffer.byteLength - 10)),
    "data-corrupt",
  );
  const altered = new Uint8Array(buffer.slice(0));
  altered[100] ^= 1;
  assert.equal(await reject(altered.buffer), "data-corrupt");
  // Right hash and length for the wrong content: not JSON.
  const junk = new TextEncoder().encode(
    "not json at all".padEnd(buffer.byteLength, " "),
  );
  const junkRecord = {
    ...parsed,
    content: {
      ...parsed.content,
      sha256: createHash("sha256").update(junk).digest("hex"),
    },
  };
  assert.equal(
    await reject(junk.buffer as ArrayBuffer, junkRecord),
    "data-corrupt",
  );
  // Consistent hash but the record claims a different feature count.
  const miscounted = {
    ...parsed,
    content: { ...parsed.content, featureCount: 6 },
  };
  assert.equal(await reject(buffer, miscounted), "data-corrupt");
});
