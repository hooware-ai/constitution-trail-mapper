// Records commit, Kotlin core and dataset identity for the exact files in dist/. `--strict` refuses a dirty tree.
import { writeProvenance } from "./lib/provenance.mjs";

const strict = process.argv.includes("--strict");
writeProvenance({ allowDirty: !strict })
  .then((p) =>
    console.log(
      `Provenance written: commit ${p.source.commit?.slice(0, 12)}${p.source.dirty ? " (dirty)" : ""}, core ${p.core.inputsSha256.slice(0, 12)}, dataset ${p.dataset.id}@${p.dataset.version} (${p.dataset.kind}), ${p.files.length} files, public release ${p.publicRelease.allowed ? "allowed" : "blocked"}.`,
    ),
  )
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
