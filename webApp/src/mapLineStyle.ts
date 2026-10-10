/** Presentation only: never changes feature admission or route eligibility. */
export const mapLineStyles = {
  trail: { color: "#08725f", dashArray: undefined, cue: "solid line" },
  park: { color: "#63a375", dashArray: "12 4", cue: "long dashes" },
  access: {
    color: "#4d6888",
    dashArray: "8 3 2 3 2 3",
    cue: "dash and two short ticks",
  },
  shared: { color: "#68718b", dashArray: "3 3", cue: "short ticks" },
  verified: {
    color: "#b01767",
    dashArray: "12 3 2 3",
    cue: "dash and short tick",
  },
  proposed: { color: "#7851a9", dashArray: "6 7", cue: "spaced short dashes" },
  closed: {
    color: "#b45309",
    dashArray: "3 7",
    cue: "short dashes and no-entry signs",
  },
} as const;
export type MapLineKind = keyof typeof mapLineStyles;
export function featureLineKind(feature: {
  id: string;
  status: string;
  roles: string[];
}): MapLineKind {
  if (feature.status === "Proposed") return "proposed";
  if (feature.id.startsWith("verified-osm:way:")) return "verified";
  if (feature.roles.includes("SharedRoadways")) return "shared";
  if (feature.roles.includes("ParkConnectors")) return "park";
  return "trail";
}

/** Butt caps keep short gaps open even on the heavier selected route. */
export function mapStroke(kind: MapLineKind) {
  const { color, dashArray } = mapLineStyles[kind];
  return {
    color,
    dashArray,
    lineCap: dashArray ? ("butt" as const) : ("round" as const),
  };
}
