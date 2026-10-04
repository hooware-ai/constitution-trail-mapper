// Compares the address-index prototype with the six catalog places the web app already ships (src/search.ts). Offline,
// read-only: it loads the ignored index built by build-address-index.mts and prints, per place, what the index says for the
// catalog's published address text, how far that point is from the catalog's reviewed marker, and what the bounded
// reverse label says at the marker. A county address point is a different thing from a reviewed entrance: the distance is
// reported, not corrected.
//
//   npx tsx tools/compare-address-catalog.mts [--index <index.json>]
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AddressIndex, type AddressIndexData } from "../src/addressIndex.ts";
import { places, searchPlaces } from "../src/search.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const file = resolve(
  arg("--index") ??
    join(here, "..", "..", "data", "generated", "web-address-index.json"),
);
const index = new AddressIndex(
  JSON.parse(readFileSync(file, "utf8")) as AddressIndexData,
);

const meters = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) =>
  Math.round(
    Math.hypot(
      (a.latitude - b.latitude) * 111_195,
      (a.longitude - b.longitude) *
        111_195 *
        Math.cos((a.latitude * Math.PI) / 180),
    ),
  );

const out = places.map((place) => {
  const typed = (place.address ?? "").split("·")[0].trim();
  const result = index.search(typed);
  const row: Record<string, unknown> = {
    place: place.label,
    typed,
    catalogAddressSearch: searchPlaces(typed, null).map((p) => p.label),
  };
  if (result.kind === "matches") {
    row.index = {
      kind: "matches",
      ambiguous: result.ambiguous,
      places: result.places.map((p) => ({
        label: p.label,
        units: p.units.length,
        metersFromCatalogMarker: meters(p, place),
      })),
    };
  } else if (result.kind === "nearest-numbers") {
    row.index = {
      kind: "nearest-numbers",
      street: result.street,
      lower: result.lower && {
        label: result.lower.label,
        metersFromCatalogMarker: meters(result.lower, place),
      },
      higher: result.higher && {
        label: result.higher.label,
        metersFromCatalogMarker: meters(result.higher, place),
      },
    };
  } else row.index = result;
  const near = index.nearest(place);
  row.reverseLabelAtCatalogMarker = near
    ? { label: near.label, distanceMeters: near.distanceMeters }
    : null;
  return row;
});
console.log(JSON.stringify(out, null, 1));
