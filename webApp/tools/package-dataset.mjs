// Packages the reviewed county trails into webApp/generated/county/ (ignored by Git).
//
//   node tools/package-dataset.mjs [--input <extract.json>] [--out <dir>] [--osm-additions [<file>]]
//
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

packageFromFiles({
  inputFile: arg("--input") ?? licensedInputFile,
  outDir: arg("--out") ?? packageDir,
  osmInput,
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
