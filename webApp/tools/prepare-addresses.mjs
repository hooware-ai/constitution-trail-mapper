// Reproduce the pinned local address snapshot; never deploy or update a pin automatically.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot, webRoot } from "./lib/core.mjs";
import { verifyAddressPackage } from "./lib/address-package.mjs";
const raw = resolve(repoRoot, "data/generated/mcgis-addresses.raw.json");
const pin = JSON.parse(
  readFileSync(
    resolve(repoRoot, "data/web-address-index.manifest.json"),
    "utf8",
  ),
);
function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: webRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    throw new Error("Address snapshot preparation failed; no pin was changed.");
}
if (!existsSync(raw)) run(["tools/fetch-mcgis-addresses.mjs"]);
if (
  createHash("sha256").update(readFileSync(raw)).digest("hex") !==
  pin.source.raw.sha256
)
  throw new Error(
    "Downloaded county address rows changed. Review the snapshot before updating the committed pin.",
  );
run(["--import", "tsx", "tools/build-address-index.mts"]);
console.log(JSON.stringify(verifyAddressPackage(repoRoot)));
