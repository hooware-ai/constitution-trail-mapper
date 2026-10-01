// Fixed at build time by vite.config.ts (see tools/release.mjs --dataset).
declare const __TRAIL_DATASET__: "fixture" | "county";
declare const __TRAIL_CHANNEL__: "review" | "public";
/** Identity of this build, read when it was made: shown in Help and added to problem reports. */
declare const __TRAIL_BUILD__: {
  commit: string;
  dirty: boolean | null;
  core: string | null;
};
