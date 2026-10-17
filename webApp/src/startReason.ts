/**
 * The one short line shown next to a disabled Start button. It states the main reason in plain words and points to the
 * full notices on the page; it never changes whether Start is allowed (that stays the routing core's answer).
 * Precedence: the route's own blockers first (stale data, a closure), then going offline.
 */
export function startBlockedReason(input: {
  canNavigate: boolean;
  online: boolean;
  stale: boolean;
  closureCount: number;
}): string | null {
  if (input.canNavigate && input.online) return null;
  if (!input.canNavigate) {
    if (input.stale) return "Trail data changed. Recalculate before you start.";
    if (input.closureCount > 0)
      return "A closure affects this route. Recalculate before you start.";
    return "Can't start this route. See the notices below.";
  }
  return "You're offline. Start needs a connection.";
}
