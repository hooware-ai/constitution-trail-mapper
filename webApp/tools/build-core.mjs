import { spawnSync } from "node:child_process";
const windows = process.platform === "win32";
const r = spawnSync(
  windows ? "gradlew.bat" : "./gradlew",
  [":webBridge:jsBrowserProductionLibraryDistribution"],
  { cwd: "..", stdio: "inherit", shell: windows },
);
process.exit(r.status ?? 1);
