import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export function verifyAddressPackage(
  repoRoot,
  file = resolve(repoRoot, "data/generated/web-address-index.json"),
) {
  const pin = JSON.parse(
    readFileSync(
      resolve(repoRoot, "data/web-address-index.manifest.json"),
      "utf8",
    ),
  );
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new Error(
      "County address data is missing. Run npm run prepare:addresses before building the public county artifact.",
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== pin.index.sha256 || bytes.length !== pin.index.bytes)
    throw new Error(
      "County address data differs from the committed snapshot pin. Review the changed source before updating it.",
    );
  const index = JSON.parse(bytes);
  if (
    index.schema !== "trail-mapper.address-index/1" ||
    index.num.length !== pin.transform.report.indexed
  )
    throw new Error(
      "County address index schema or row count differs from its pin.",
    );
  if (
    !pin.source.completeness ||
    pin.source.completeness.transferLimitHit ||
    pin.source.completeness.fetchedRows !==
      pin.source.completeness.serviceCount ||
    pin.source.completeness.distinctIds !==
      pin.source.completeness.serviceCount ||
    !/creativecommons\.org\/licenses\/by\/4\.0/.test(
      pin.source.item.licenseInfo,
    )
  )
    throw new Error(
      "County address source lacks complete licensed snapshot evidence.",
    );
  return { file, sha256, bytes: bytes.length, rows: index.num.length };
}
