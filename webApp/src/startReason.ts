/**
 * The one short line shown next to a disabled Start button. It states the main reason in plain words and points to the
 * full notices on the page; it never changes whether Start is allowed (that stays the routing core's answer).
 * Precedence: the route's own blockers first (stale data, a closure, estimated connections), then going offline.
 */
export function startBlockedReason(input: {
  canNavigate: boolean;
  online: boolean;
  stale: boolean;
  closureCount: number;
  estimatedConnections: number;
  /** How many of those are the start or destination connection (which the notice list does not announce). */
  endpointConnections?: number;
}): string | null {
  if (input.canNavigate && input.online) return null;
  if (!input.canNavigate) {
    if (input.stale) return "Trail data changed. Recalculate before you start.";
    if (input.closureCount > 0)
      return "A closure affects this route. Recalculate before you start.";
    if (input.estimatedConnections > 0) {
      const n = input.estimatedConnections;
      const ends =
        (input.endpointConnections ?? 0) > 0 ? " (start/end included)" : "";
      return `Can't start: ${n} estimated connection${n === 1 ? "" : "s"}${ends} ${n === 1 ? "is" : "are"} not confirmed by map data. See below.`;
    }
    return "Can't start this route. See the notices below.";
  }
  return "You're offline. Start needs a connection.";
}
