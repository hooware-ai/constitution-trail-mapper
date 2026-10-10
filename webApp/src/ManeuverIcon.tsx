/** Decorative symbols follow the shared router enum; instruction text remains authoritative. */
const paths: Record<string, string> = {
  Start: "M12 21V4m-5 5 5-5 5 5",
  Continue: "M12 21V4m-5 5 5-5 5 5",
  SlightLeft: "M16 21v-8L7 4m0 7V4h7",
  TurnLeft: "M18 21v-9H4m5-5-5 5 5 5",
  SharpLeft: "M18 21V5L5 18m0-7v7h7",
  SlightRight: "M8 21v-8l9-9m-7 0h7v7",
  TurnRight: "M6 21v-9h14m-5-5 5 5-5 5",
  SharpRight: "M6 21V5l13 13m-7 0h7v-7",
  TurnAround: "M18 21V9a6 6 0 0 0-12 0v9m-4-4 4 4 4-4",
  Arrive: "M5 21V3h13l-3 4 3 4H5",
};

export function ManeuverIcon({ maneuver }: { maneuver?: string }) {
  const path =
    maneuver && Object.hasOwn(paths, maneuver) ? paths[maneuver] : null;
  if (!path) return null;
  return (
    <svg
      className="maneuver-icon"
      data-maneuver={maneuver}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
