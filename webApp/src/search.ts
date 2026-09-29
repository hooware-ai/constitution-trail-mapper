import type { Endpoint, Point } from "./types";
export const LOCAL_CENTER: Point = { latitude: 40.49, longitude: -88.97 };
// Official public facility markers; source details and access limits: docs/web/place-catalog.md.
export const places: Endpoint[] = [
  {
    label: "Tipton Park · North entrance",
    address: "2201 Stone Mountain Boulevard · Bloomington",
    latitude: 40.5092876306785,
    longitude: -88.92688066101174,
  },
  {
    label: "Culver’s · Hershey Road",
    address: "901 Hershey Road · Bloomington",
    latitude: 40.48651123046875,
    longitude: -88.94265747070312,
  },
  {
    label: "Culver’s · West Market Street",
    address: "1807 W. Market Street · Bloomington",
    latitude: 40.48445510864258,
    longitude: -89.02113342285156,
  },
  {
    label: "Normal Public Library",
    address: "206 W. College Ave. · Normal",
    latitude: 40.51064283497315,
    longitude: -88.9864803754717,
  },
  {
    label: "Fairview Park",
    address: "801 North Main Street · Normal",
    latitude: 40.5208939699945,
    longitude: -88.9952965699879,
  },
  {
    label: "Miller Park",
    address: "1020 South Morris Avenue · Bloomington",
    latitude: 40.468208633367425,
    longitude: -89.00369628168829,
  },
];
const normalize = (s: string) =>
  s.toLocaleLowerCase().replace(/[’']/g, "").normalize("NFKD");
export function searchPlaces(
  query: string,
  start: Point | null,
  catalog: Endpoint[] = places,
): Endpoint[] {
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return catalog.slice(0, 8);
  const anchor = start ?? LOCAL_CENTER;
  return catalog
    .filter((p) =>
      words.every((w) =>
        normalize(p.label + " " + (p.address ?? "")).includes(w),
      ),
    )
    .sort(
      (a, b) =>
        distanceSquared(a, anchor) - distanceSquared(b, anchor) ||
        a.label.localeCompare(b.label),
    )
    .slice(0, 8);
}
function distanceSquared(a: Point, b: Point) {
  return (
    (a.latitude - b.latitude) ** 2 +
    ((a.longitude - b.longitude) * Math.cos((b.latitude * Math.PI) / 180)) ** 2
  );
}
