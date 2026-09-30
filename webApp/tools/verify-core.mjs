// Fails unless the generated Kotlin core matches the current Kotlin sources (see tools/lib/core.mjs).
import { verifyCoreManifest } from "./lib/core.mjs";

verifyCoreManifest()
  .then((manifest) =>
    console.log(
      `Kotlin core verified: inputs ${manifest.inputs.sha256.slice(0, 12)}, output ${manifest.outputs.sha256.slice(0, 12)}.`,
    ),
  )
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
