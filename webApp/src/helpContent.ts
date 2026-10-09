// Pure helpers for the Help and about dialog: what the loaded data covers, how this build identifies itself, and the
// privacy-safe problem-report template. Nothing here reads a route, place, label, location or history.
import type { Feature, Network } from "./types";

export interface BuildInfo {
  /** Short source commit, or "unknown" when the build could not read it. */
  commit: string;
  /** Uncommitted changes were present when this build was made (null: unknown). */
  dirty: boolean | null;
  /** First 12 hex of the routing core's input hash, when the build could read it. */
  core: string | null;
  dataset: "fixture" | "county";
  channel: "review" | "public";
}

export interface Coverage {
  trails: number;
  km: number;
  south: number;
  north: number;
  west: number;
  east: number;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
function metersBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const dLat = toRadians(b.latitude - a.latitude),
    dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) *
      Math.cos(toRadians(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

/** Extent and length of the trails that are actually loaded, or null when there are none. */
export function coverageOf(features: readonly Feature[]): Coverage | null {
  let meters = 0,
    south = Infinity,
    north = -Infinity,
    west = Infinity,
    east = -Infinity;
  for (const feature of features)
    for (const path of feature.paths) {
      path.forEach((point, index) => {
        south = Math.min(south, point.latitude);
        north = Math.max(north, point.latitude);
        west = Math.min(west, point.longitude);
        east = Math.max(east, point.longitude);
        if (index > 0) meters += metersBetween(path[index - 1], point);
      });
    }
  return features.length && Number.isFinite(south)
    ? {
        trails: features.length,
        km: Math.round(meters / 100) / 10,
        south,
        north,
        west,
        east,
      }
    : null;
}

/** What the loaded features are, from their own status and roles, so copy never claims more or less than is loaded. */
export interface FeatureMix {
  existing: number;
  proposed: number;
  /** Existing features that are roads shared with traffic. */
  shared: number;
}
export function featureMix(features: readonly Feature[]): FeatureMix {
  const existing = features.filter((f) => f.status !== "Proposed");
  return {
    existing: existing.length,
    proposed: features.length - existing.length,
    shared: existing.filter((f) => f.roles.includes("SharedRoadways")).length,
  };
}

const degrees = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;
/** "40.28° N to 40.76° N, 89.21° W to 88.71° W": a rough extent, not a boundary. */
export const extentText = (coverage: Coverage) =>
  `${degrees(coverage.south, "N", "S")} to ${degrees(coverage.north, "N", "S")}, ` +
  `${degrees(coverage.west, "E", "W")} to ${degrees(coverage.east, "E", "W")}`;

export function buildText(build: BuildInfo): string {
  const state =
    build.dirty === null
      ? ""
      : build.dirty
        ? " (with uncommitted changes)"
        : "";
  return (
    `${build.commit}${state}` +
    (build.core ? ` · routing core ${build.core}` : "") +
    ` · ${build.dataset === "county" ? "county data build" : "synthetic review build"}` +
    ` · ${build.channel} channel`
  );
}

export function datasetText(network: Network | null): string {
  if (!network) return "Trail data has not loaded yet.";
  if (network.mode === "fixture")
    return "Synthetic review network (not real trails)";
  if (!network.datasetRecord)
    return "Private local review data (no recorded identity)";
  const record = network.datasetRecord;
  return `${record.id} · version ${record.version} · data ${record.content.sha256.slice(0, 12)}`;
}

export interface ReportContext {
  build: BuildInfo;
  network: Network | null;
}

const BROWSER_LINE = "Browser and screen:";
/**
 * The report the rider reviews and edits before using it anywhere. It contains only the app and data version; no
 * location, route, place name, saved item, history or account detail is ever added, and there is no identifier.
 */
export function reportTemplate({ build, network }: ReportContext): string {
  return [
    "Trail Mapper problem report",
    "(Read this before you send it. Delete anything you do not want to share. Do not add your location, routes, saved place names or personal details.)",
    "",
    "What happened:",
    "",
    "What you expected:",
    "",
    "Which screen or step:",
    "",
    "How often it happens:",
    "",
    "App details (version only):",
    `Build: ${buildText(build)}`,
    `Data: ${datasetText(network)}`,
  ].join("\n");
}

/** Voluntary feedback is written by the rider, never inferred from GPS or history. */
export function riderFeedbackTemplate({
  build,
  network,
}: ReportContext): string {
  return [
    "Trail Mapper ride feedback",
    "(Optional. Review this before sharing. Do not add your location, route geometry, saved names or personal details. Nothing is sent automatically.)",
    "",
    "What did you try? (Plan a route / understand a warning / save and reopen in this browser / foreground guidance):",
    "",
    "Did that task work? (Yes / partly / no / not tried):",
    "",
    "Did you plan only, try guidance, or actually ride? Planning or opening a route is not a completed ride:",
    "",
    "Was this your first visit or a return visit? What brought you back?",
    "",
    "What worked, and what got in your way?",
    "",
    "What did the app prevent you from doing, or what would make you return?",
    "",
    "App details (version only):",
    `Build: ${buildText(build)}`,
    `Data: ${datasetText(network)}`,
  ].join("\n");
}

/** Adds or removes the optional browser line; the rider sees exactly what it adds. */
export function withBrowserDetails(
  report: string,
  include: boolean,
  details: string,
): string {
  const lines = report
    .split("\n")
    .filter((line) => !line.startsWith(BROWSER_LINE));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (include) lines.push(`${BROWSER_LINE} ${details}`);
  return lines.join("\n");
}

/** Where problem reports can go today: the project's public issue tracker. There is no private inbox yet. */
export const REPORT_URL =
  "https://github.com/hooware-ai/constitution-trail-mapper/issues/new";
