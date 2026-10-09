// Re-verifies webApp/generated/county (or TRAIL_COUNTY_DIR) against the reviewed manifest before a county build.
//
//   node tools/verify-county-package.mjs
//
// Recomputes the geometry and attribute digests from the packaged bytes, checks the exact 254-feature set, the excluded
// ids, roles and record consistency. A standalone script so the release check never passes JavaScript through a shell.
import { AdmissionError, verifyPackageDir } from "./lib/dataset-package.mjs";

try {
  const { record } = await verifyPackageDir();
  console.log(
    `County package verified: ${record.version}, ${record.content.featureCount} features, approved: ${record.approval.approved}.`,
  );
} catch (error) {
  console.error(
    (error instanceof AdmissionError
      ? `County package refused: ${error.message}`
      : `County package could not be read: ${error.message}`) +
      " Run `npm run package:dataset` first.",
  );
  process.exit(1);
}
