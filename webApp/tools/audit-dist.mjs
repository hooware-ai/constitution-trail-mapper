// Audits the exact files in dist/. Two separate questions:
//  1. Does anything publication-sensitive appear in it? (local review assets, credentials, private keys)
//  2. Is it allowed to be published? Only an approved, fully identified dataset on a clean commit can be:
//     passing question 1 never answers question 2.
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { artifactFiles, distDir, verifyProvenance } from "./lib/provenance.mjs";

const prohibited =
  /mcgis-trails\.normalized|mclean-access-roads\.normalized|verified-trail-additions\.normalized|web-licensed-trails\.normalized|AIza[0-9A-Za-z_-]{30}|BEGIN (RSA |EC )?PRIVATE KEY|firebase-adminsdk|service_account/;
const publicMode = process.argv.includes("--public");

const files = await artifactFiles();
for (const file of files) {
  const full = join(distDir, ...file.path.split("/"));
  if (
    prohibited.test(file.path) ||
    prohibited.test(await readFile(full, "utf8"))
  )
    throw new Error(
      "Publication-sensitive content in " +
        relative(process.cwd(), full).split(sep).join("/"),
    );
}
const provenance = await verifyProvenance();
if (publicMode && !provenance.publicRelease.allowed)
  throw new Error(
    "Public release blocked: " +
      provenance.publicRelease.blockers.join("; ") +
      ".",
  );
console.log(
  `Distribution audit passed: ${files.length} files, no local review assets or credential patterns, provenance verified. ` +
    (provenance.publicRelease.allowed
      ? "Dataset approved for public release."
      : "NOT approved for public release: " +
        provenance.publicRelease.blockers.join("; ") +
        "."),
);
