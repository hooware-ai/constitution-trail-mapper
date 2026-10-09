import type { AccessGap } from "./types";
import { connectionsToCheck, gapDistance } from "./gapDistance";

// Temporary presentation choice requested by the owner. Restore this flag to show the cards again.
// Route validation and map uncertainty stay independent of this notification surface.
export const CONNECTION_CHECK_NOTICES_ENABLED = false;

export function AccessConnections({
  gaps: allGaps,
  onShow,
}: {
  gaps: AccessGap[];
  onShow: (id: string) => void;
}) {
  if (!CONNECTION_CHECK_NOTICES_ENABLED) return null;
  const gaps = connectionsToCheck(allGaps);
  if (!gaps.length) return null;
  const total = gaps.reduce((sum, gap) => sum + gap.distanceMeters, 0);
  return (
    <section className="access-connections" aria-labelledby="connections-title">
      <h3 id="connections-title">
        {gaps.length} {gaps.length === 1 ? "connection" : "connections"} to
        check
      </h3>
      <p className="connection-total">
        {total < 0.3048 ? "Less than 1 ft" : `About ${gapDistance(total)}`} ·
        not confirmed by map data · select one to see it
      </p>
      <ol>
        {gaps.map((gap, index) => (
          <li key={gap.id}>
            <button
              onClick={() => onShow(gap.id)}
              aria-label={`Show connection ${index + 1}: ${gap.label}, ${gapDistance(gap.distanceMeters)} on map`}
            >
              <span className="connection-number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="connection-name">{gap.label}</span>
              <span className="connection-distance">
                {gapDistance(gap.distanceMeters)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
