import type { RouteResult } from "./types";

/**
 * Whether a freshly described reversed loop may replace the route being shown or ridden, and what must happen when it
 * may not.
 *
 * A reversal inside a ride restarts that ride, so it is held to the same rule as starting one: the fresh description must
 * say the route can be navigated (no blocking closure, a current network, mapped access). When it says no, the live ride
 * is NOT left running on the old route: the same closure or data change that blocks the reversed loop blocks the loop
 * being ridden, so guidance and the credit earned under it are dropped, and the rider is told why. Riding resumes only
 * through a fresh route that is itself accepted (recalculate or choose another, then Start), never by a guess.
 *
 * In a preview nothing is started, so the reversed route is shown as it is and its Start control carries the verdict.
 */
export type ReverseDecision =
  | { kind: "proceed" }
  | { kind: "stop-ride"; message: string };

export function reverseOutcome(
  result: Pick<RouteResult, "canNavigate" | "warnings">,
  rideActive: boolean,
): ReverseDecision {
  if (!rideActive || result.canNavigate) return { kind: "proceed" };
  const reasons = (result.warnings ?? []).join(" ").trim();
  return {
    kind: "stop-ride",
    message:
      "Navigation stopped: this loop cannot be ridden right now, in either direction, and the distance observed on this ride was cleared." +
      (reasons ? ` ${reasons}` : "") +
      " Recalculate it or choose another route, then start again.",
  };
}

/** What the App needs from the navigation controller to carry the decision out (the real controller satisfies it). */
export interface RideControls {
  start(record: unknown): void;
  stop(): void;
}

/**
 * Applies a decision to the live ride. Returns true when the reversed route replaced the ride (a fresh ride, credit
 * zero), false when the ride was stopped instead. Nothing here ever leaves the old guidance running on a decision that
 * said stop.
 */
export function applyReverse(
  decision: ReverseDecision,
  rideActive: boolean,
  controls: RideControls | null,
  reversedRecord: unknown,
): boolean {
  if (decision.kind === "stop-ride") {
    controls?.stop();
    return false;
  }
  if (rideActive) controls?.start(reversedRecord);
  return true;
}
