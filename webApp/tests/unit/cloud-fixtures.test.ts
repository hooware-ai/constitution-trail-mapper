import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CloudRecordError,
  engineMatchesRecord,
  parsePlaceRecord,
  parseRouteRecord,
} from "../../src/cloud/contract";
import { buildFixtureSet } from "../support/cloud-fixture-set";

const directory = join(process.cwd(), "tests", "fixtures", "cloud");
const read = async (name: string) =>
  JSON.parse(await readFile(join(directory, name), "utf8"));

test("the committed fixtures are exactly what the contract builders produce (regenerate with tools/generate-cloud-fixtures.ts)", async () => {
  const expected = await buildFixtureSet();
  assert.deepEqual(
    (await readdir(directory)).sort(),
    Object.keys(expected).sort(),
  );
  for (const [name, value] of Object.entries(expected))
    assert.deepEqual(await read(name), JSON.parse(JSON.stringify(value)), name);
});

test("valid fixtures open; their engine routes describe their own geometry", async () => {
  for (const name of [
    "route-point-to-point.json",
    "route-loop.json",
    "route-no-engine.json",
  ]) {
    const record = parseRouteRecord(await read(name));
    assert.equal(record.dataset.kind, "fixture");
    assert.equal(record.ownerUid, "fixture-user-a");
    if (record.engine) await engineMatchesRecord(record);
  }
  assert.equal(
    parsePlaceRecord(await read("place.json")).ownerUid,
    "fixture-user-a",
  );
});

test("every invalid fixture is refused with the code it names, and none opens partly", async () => {
  const { invalid } = await read("invalid-records.json");
  assert.ok(invalid.length > 30);
  for (const entry of invalid) {
    const parse = entry.type === "route" ? parseRouteRecord : parsePlaceRecord;
    try {
      parse(entry.record);
      assert.fail(`${entry.name} was accepted`);
    } catch (error) {
      assert.ok(error instanceof CloudRecordError, `${entry.name}: ${error}`);
      assert.equal((error as CloudRecordError).code, entry.expect, entry.name);
    }
  }
});
