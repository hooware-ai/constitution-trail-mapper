// Fixed at build time by vite.config.ts (see tools/release.mjs --dataset).
declare const __TRAIL_DATASET__: "fixture" | "county";
declare const __TRAIL_CHANNEL__: "review" | "public";
/** PRIVATE TEST MODE, build time only and default false: estimated connections are assumed traversable (review builds only). */
declare const __TRAIL_ASSUME_ESTIMATED__: boolean;
/** Pinned, hash-named local county address index, or null for a build that carries none. */
declare const __TRAIL_ADDRESS_INDEX__: { file: string; sha256: string } | null;
/** Identity of this build, read when it was made: shown in Help and added to problem reports. */
declare const __TRAIL_BUILD__: {
  commit: string;
  dirty: boolean | null;
  core: string | null;
  assumeEstimated: boolean;
};
