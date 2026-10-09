import type { CoreManifest, CorePaths } from "./lib/core.mjs";
export function buildCore(options?: {
  run?: () => void | Promise<void>;
  paths?: CorePaths;
}): Promise<CoreManifest>;
