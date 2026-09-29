import {
  MAX_FIX_ACCURACY_METERS,
  usableFix,
  type LocationFix,
  type LocationPort,
} from "./navigation";

export const PLANNER_LOCATION_TIMEOUT_MS = 20_000;
export type PlannerLocationFailure =
  | "insecure"
  | "unsupported"
  | "denied"
  | "unavailable"
  | "timeout"
  | "inaccurate"
  | "startup";
export type PlannerLocationEvent =
  | { phase: "waiting"; message: string }
  | { phase: "success"; fix: LocationFix }
  | { phase: "failure"; reason: PlannerLocationFailure; message: string };
interface Dependencies {
  location?: LocationPort;
  secureContext: boolean;
  now?: () => number;
  setTimeout?: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}
const messages: Record<
  Exclude<PlannerLocationFailure, "inaccurate">,
  string
> = {
  insecure:
    "Location needs a secure connection. Open this site over HTTPS or on this device’s localhost, then try again.",
  unsupported:
    "This browser does not provide location. Open the site in your regular browser, or choose a place or map point.",
  denied:
    "Location access was blocked. Check location permission for this site and your device’s location settings, then try again.",
  unavailable:
    "Your browser could not determine your location. Check your device’s location services. If you’re using an embedded preview, try opening the site in your regular browser.",
  timeout:
    "Your browser did not return a location in time. Check for a location permission prompt, then try again. An embedded preview may need to be opened in your regular browser.",
  startup:
    "Location could not start in this browser. Try again or open the site in your regular browser.",
};

/** Wait for accuracy to improve, while bounding even an unanswered permission prompt. */
export function acquirePlannerLocation(
  deps: Dependencies,
  listener: (event: PlannerLocationEvent) => void,
): () => void {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimeout ?? globalThis.setTimeout;
  const clearTimer =
    deps.clearTimeout ??
    ((id: unknown) =>
      globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
  let active = true;
  let watchId: number | undefined;
  let timer: unknown;
  let coarseAccuracy: number | undefined;
  const cancel = () => {
    active = false;
    if (timer !== undefined) clearTimer(timer);
    if (watchId !== undefined) deps.location?.clearWatch(watchId);
    timer = undefined;
    watchId = undefined;
  };
  const fail = (reason: PlannerLocationFailure) => {
    if (!active) return;
    cancel();
    listener({
      phase: "failure",
      reason,
      message:
        reason === "inaccurate"
          ? `Your browser’s location is only accurate to about ${Math.round(coarseAccuracy!)} m. Try again for a more precise reading, or choose your exact position on the map.`
          : messages[reason],
    });
  };
  const timeout = () =>
    fail(coarseAccuracy === undefined ? "timeout" : "inaccurate");
  if (!deps.secureContext) fail("insecure");
  else if (!deps.location) fail("unsupported");
  else {
    listener({
      phase: "waiting",
      message: "Getting your location… Allow location if your browser asks.",
    });
    timer = setTimer(timeout, PLANNER_LOCATION_TIMEOUT_MS);
    try {
      const id = deps.location.watch(
        (fix) => {
          if (!active) return;
          if (usableFix(fix, now())) {
            cancel();
            listener({ phase: "success", fix });
          } else if (
            Number.isFinite(fix.accuracy) &&
            fix.accuracy > MAX_FIX_ACCURACY_METERS &&
            usableFix({ ...fix, accuracy: 0 }, now())
          ) {
            coarseAccuracy = Math.min(coarseAccuracy ?? Infinity, fix.accuracy);
            listener({
              phase: "waiting",
              message: `Location found within about ${Math.round(fix.accuracy)} m. Waiting for a more precise reading…`,
            });
          }
        },
        (error) => {
          if (error.code === 3) timeout();
          else fail(error.code === 1 ? "denied" : "unavailable");
        },
      );
      if (active) watchId = id;
      else deps.location.clearWatch(id);
    } catch {
      fail("startup");
    }
  }
  return cancel;
}
