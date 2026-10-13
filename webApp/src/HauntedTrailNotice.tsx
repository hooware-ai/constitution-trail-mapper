import { useEffect, useState } from "react";
import { SafeLink } from "./components";

// Informational event dates only, never a closure interval or routing geometry.
// October 25 midnight in America/Chicago is 05:00 UTC (CDT, UTC−05:00).
export const HAUNTED_TRAIL_PAST_AT = Date.parse("2026-10-25T00:00:00-05:00");
export const hauntedTrailIsPast = (now: number) => now >= HAUNTED_TRAIL_PAST_AT;

export function HauntedTrailNotice() {
  const [now, setNow] = useState(Date.now);
  const past = hauntedTrailIsPast(now);
  useEffect(() => {
    if (past) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(HAUNTED_TRAIL_PAST_AT - Date.now() + 1, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [now, past]);
  return (
    <section aria-label="Haunted Trail event advisory">
      <article data-event-advisory="haunted-trail-2026">
        <p className="update-status">
          {past
            ? "Past event notice · reopening not confirmed"
            : "Reported event notice · exact closure dates and portions unconfirmed"}
        </p>
        <h2>Haunted Trail: reported temporary trail closures</h2>
        <p>
          Normal reports closures affecting portions of Constitution Trail
          between Connie Link Amphitheatre and West Phoenix Avenue, 2–9 p.m.
          Chicago local time (CDT). Event dates are October 15–17 and 23–24,
          2026. The closure sentence does not specify which dates apply or the
          exact affected portions. This is not a continuous October 15–24
          closure. Follow posted signs; bikes are not allowed at the event.
        </p>
        {past && (
          <p>
            These event dates have passed. That does not confirm reopening or
            current trail conditions.
          </p>
        )}
        <p className="caption">
          Sources checked October 13, 2026. Routes do not account for this
          informational notice.
        </p>
        <ul>
          <li>
            <SafeLink href="https://www.normalil.gov/m/NewsFlash/Home/Detail/3363">
              Normal’s October 7 closure notice
            </SafeLink>
          </li>
          <li>
            <SafeLink href="https://www.normalil.gov/349/Haunted-Trail">
              Official event dates and bike rule
            </SafeLink>
          </li>
          <li>
            <SafeLink href="https://www.normalil.gov/DocumentCenter/View/479/Haunted-Trail--Volunteers">
              Official 2026 volunteer dates
            </SafeLink>
          </li>
        </ul>
      </article>
    </section>
  );
}
