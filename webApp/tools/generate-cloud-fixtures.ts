// Regenerates tests/fixtures/cloud/*.json from the contract builders:  npx tsx tools/generate-cloud-fixtures.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildFixtureSet } from "../tests/support/cloud-fixture-set";

const directory = resolve(
  import.meta.dirname,
  "..",
  "tests",
  "fixtures",
  "cloud",
);
await mkdir(directory, { recursive: true });
for (const [name, value] of Object.entries(await buildFixtureSet()))
  await writeFile(join(directory, name), JSON.stringify(value, null, 2) + "\n");
console.log(`Wrote the cloud fixtures to ${directory}`);
