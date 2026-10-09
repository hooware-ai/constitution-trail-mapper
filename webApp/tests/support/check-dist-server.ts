import type { FullConfig } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { distDir } from "../../tools/lib/provenance.mjs";
import { verifyServedProvenance } from "../../tools/lib/served-artifact.mjs";

export default async function checkDistServer(config: FullConfig) {
  const urls = new Set(config.projects.map((project) => project.use.baseURL));
  if (urls.has(undefined) || urls.size === 0)
    throw new Error(
      "Built-artifact test projects must define their server baseURL.",
    );
  const expected = await readFile(join(distDir, "provenance.json"));
  await Promise.all(
    [...urls].map((url) => verifyServedProvenance(url!, expected)),
  );
}
