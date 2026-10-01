import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  CloudRecordError,
  decodeEngine,
  engineMatchesRecord,
  parsePlaceRecord,
  parseRouteRecord,
} from "../../src/cloud/contract";
import { buildFixtureSet } from "../support/cloud-fixture-set";

const directory = join(process.cwd(), "tests", "fixtures", "cloud");
const read = async (name: string) =>
  JSON.parse(await readFile(join(directory, name), "utf8"));

/**
 * Compares by meaning, not by compressed bytes: the engine payload is gzip, and the same JSON can compress to different
 * bytes on another platform or zlib build (a hosted-CI run on Linux showed a different header byte). Every engine
 * payload is decoded and compared as JSON; everything else must match exactly.
 */
async function meaning(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(meaning));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value))
      out[key] =
        key === "engine" && typeof inner === "string"
          ? {
              decodedEngine: await decodeEngine(
                Uint8Array.from(Buffer.from(inner, "base64")),
              ),
            }
          : await meaning(inner);
    return out;
  }
  return value;
}

test("the committed fixtures say exactly what the contract builders produce (regenerate with tools/generate-cloud-fixtures.ts)", async () => {
  const expected = await buildFixtureSet();
  assert.deepEqual(
    (await readdir(directory)).sort(),
    Object.keys(expected).sort(),
  );
  for (const [name, value] of Object.entries(expected))
    assert.deepEqual(
      await meaning(await read(name)),
      await meaning(JSON.parse(JSON.stringify(value))),
      name,
    );
});

test("fixture comparison ignores only incidental compressed bytes: a changed engine route is still a difference", async () => {
  const record = await read("route-point-to-point.json");
  const engine: any = await decodeEngine(
    Uint8Array.from(Buffer.from(record.engine, "base64")),
  );
  const sameBytesDifferentGzip = {
    ...record,
    engine: Buffer.from(
      gzipSync(JSON.stringify(engine), { level: 1 }),
    ).toString("base64"),
  };
  assert.deepEqual(
    await meaning(sameBytesDifferentGzip),
    await meaning(record),
  );
  engine.segments[0].points[0].latitude += 0.001;
  const changed = {
    ...record,
    engine: Buffer.from(gzipSync(JSON.stringify(engine))).toString("base64"),
  };
  assert.notDeepEqual(await meaning(changed), await meaning(record));
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
