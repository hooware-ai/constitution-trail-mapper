// Packages the reviewed county trails into webApp/generated/county/ (ignored by Git).
//
//   node tools/package-dataset.mjs [--input <extract.json>] [--out <dir>] [--osm-additions [<file>]] [--access-roads <file>]
//
// --proposed-trails [<file>] packages proposed segments as their own opt-in, preview-only layer. It is refused unless
// data/web-proposed-trails.manifest.json records a GRANTED rights block with evidence (it records "unresolved" today).
//
// --access-roads packages ordinary-road access (TIGER base roads plus endpoint-local service roads) as hash-named base,
// tile and index files, pinned by the record, so the browser fetches service-road tiles only near a trip's endpoints.
// --osm-additions also packages the four reviewed OpenStreetMap paths native loads, as their own layer, after verifying
// each way against data/verified-trail-additions.manifest.json (geometry hash recomputed). Off by default.
//
// Reads the private extract written by `python tools/fetch-web-review-data.py`; never contacts a server and never
// widens the reviewed manifest. Refuses (and leaves any existing package untouched) on any admission failure.
import {
  AdmissionError,
  licensedInputFile,
  osmInputFile,
  packageDir,
  packageFromFiles,
  proposedInputFile,
} from "./lib/dataset-package.mjs";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};

// `--osm-additions` alone uses the default extract path; `--osm-additions <file>` names one.
const osmIndex = process.argv.indexOf("--osm-additions");
const osmInput =
  osmIndex < 0
    ? null
    : process.argv[osmIndex + 1] && !process.argv[osmIndex + 1].startsWith("--")
      ? process.argv[osmIndex + 1]
      : osmInputFile;

// `--proposed-trails [<file>]` opens the rights-gated proposed-trails seam; without a granted rights block it refuses.
const proposedIndex = process.argv.indexOf("--proposed-trails");
const proposedInput =
  proposedIndex < 0
    ? null
    : process.argv[proposedIndex + 1] &&
        !process.argv[proposedIndex + 1].startsWith("--")
      ? process.argv[proposedIndex + 1]
      : proposedInputFile;

packageFromFiles({
  inputFile: arg("--input") ?? licensedInputFile,
  outDir: arg("--out") ?? packageDir,
  osmInput,
  accessInput: arg("--access-roads") ?? null,
  proposedInput,
})
  .then(({ record }) =>
    console.log(
      `Packaged ${record.content.featureCount} reviewed features -> ${record.version}\n` +
        `  network ${record.content.file} (${record.content.bytes} bytes)\n` +
        `  approved: ${record.approval.approved}; blockers: ${record.approval.blockers.length}`,
    ),
  )
  .catch((error) => {
    console.error(
      error instanceof AdmissionError
        ? `Not packaged: ${error.message}`
        : error.message,
    );
    process.exit(1);
  });
