import type { AccessGap } from "./types";
import { connectionsToCheck, gapDistance } from "./gapDistance";

export function AccessConnections({
  gaps: allGaps,
  onShow,
}: {
  gaps: AccessGap[];
  onShow: (id: string) => void;
}) {
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
        {total < 0.3048 ? "Less than 1 ft" : `About ${gapDistance(total)}`}{" "}
        total · included in route length
      </p>
      <p>
        Map data is missing a confirmed link at these points. Select a
        connection to see where.
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
