import {
  AddressIndex,
  type AddressIndexData,
  type AddressPlace,
  type AddressSearch,
} from "./addressIndex";
import type { Endpoint } from "./types";

// Address search in the place chooser. The county address index is a separate file that is fetched ONLY when a rider types
// something that looks like an address, never at start-up, and the typed text is never sent anywhere: the request is for a
// fixed file and the search runs on this device. An address point is the county's record of where an address is. It is NOT
// a verified trail entrance: choosing one places the endpoint exactly there, nothing snaps it to a trail, and the routing
// core's unverified-connection and closure rules apply to it like any other point.

/** What a build offers, fixed at build time: the index file (hash-named, opt-in) or nothing. */
export interface AddressIndexSource {
  url: string;
  sha256: string | null;
}
/** Review fixtures read a synthetic index from this path (tests intercept it); a county build never asks for it. */
export const FIXTURE_ADDRESS_INDEX_PATH = "data/address-index.fixture.json";

export function addressIndexSource(
  fixture: boolean,
  built: { file: string; sha256: string } | null,
): AddressIndexSource | null {
  if (fixture) return { url: FIXTURE_ADDRESS_INDEX_PATH, sha256: null };
  return built ? { url: built.file, sha256: built.sha256 } : null;
}

/** A house number followed by street text ("421 n main", "12A Oak"): the only input that starts address search. */
export function looksLikeAddress(text: string): boolean {
  return /^\s*\d+[A-Za-z]?(?:-\d+|\s1\/2)?\s+\S/.test(text);
}

const loaded = new Map<string, Promise<AddressIndex>>();
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
/** Loads the index once per page; a failure is not cached, so the rider can try again. */
export function loadAddressIndex(
  source: AddressIndexSource,
  fetcher: typeof fetch = fetch,
): Promise<AddressIndex> {
  const cached = loaded.get(source.url);
  if (cached) return cached;
  const promise = (async () => {
    const response = await fetcher(
      new URL(
        source.url,
        typeof document === "undefined"
          ? "http://localhost/"
          : document.baseURI,
      ),
      {
        cache: "no-cache",
      },
    );
    if (!response.ok) throw new Error("The address data is not available.");
    const bytes = await response.arrayBuffer();
    if (source.sha256 && (await sha256Hex(bytes)) !== source.sha256)
      throw new Error("The address data did not match its recorded hash.");
    return new AddressIndex(
      JSON.parse(new TextDecoder().decode(bytes)) as AddressIndexData,
    );
  })();
  loaded.set(source.url, promise);
  promise.catch(() => loaded.delete(source.url));
  return promise;
}

export const ADDRESS_POINT_NOTE =
  "County address point · not a verified trail entrance";

export interface AddressChoice {
  key: string;
  endpoint: Endpoint;
  title: string;
  detail: string;
}
export interface AddressChoices {
  choices: AddressChoice[];
  /** Plain-language context shown above the choices (ambiguity, nearest numbers, street list, no match). */
  notice: string | null;
}

const meters = (a: Endpoint, b: Endpoint) =>
  Math.round(
    Math.hypot(
      (a.latitude - b.latitude) * 111_195,
      (a.longitude - b.longitude) *
        111_195 *
        Math.cos((a.latitude * Math.PI) / 180),
    ),
  );
const choiceOf = (
  place: AddressPlace,
  suffix: string,
  key: string,
  extra: string[] = [],
): AddressChoice => {
  const where = [place.city, place.zip].filter(Boolean).join(" ");
  const units = place.units.length
    ? `Units: ${place.units.slice(0, 4).join(", ")}${place.units.length > 4 ? ` and ${place.units.length - 4} more` : ""}`
    : "";
  const detail = [ADDRESS_POINT_NOTE, where, units, ...extra, suffix]
    .filter(Boolean)
    .join(" · ");
  return {
    key,
    title: place.label,
    detail,
    endpoint: {
      label: place.label,
      address: `${ADDRESS_POINT_NOTE}${where ? " · " + where : ""}`,
      latitude: place.latitude,
      longitude: place.longitude,
    },
  };
};

/** Turns a search result into selectable choices. The same address at different recorded points stays several choices. */
export function addressChoices(
  result: AddressSearch,
  origin: Endpoint | null,
): AddressChoices {
  if (result.kind === "none")
    return {
      choices: [],
      notice:
        "No county address matches that. Check the number and street, or use Pick on map.",
    };
  if (result.kind === "streets")
    return {
      choices: [],
      notice: result.streets.length
        ? `Streets that match: ${result.streets.slice(0, 5).join(", ")}. Add a house number that exists on one of them.`
        : null,
    };
  if (result.kind === "nearest-numbers") {
    const near = [result.lower, result.higher].filter(
      (p): p is AddressPlace => p !== null,
    );
    return {
      choices: near.map((p, i) =>
        choiceOf(
          p,
          "Nearest number on this street, not the number you typed",
          `near-${i}`,
        ),
      ),
      notice: `${result.typed} ${result.street} is not in the county address data. These are the nearest numbers on that street; none of them is your address.`,
    };
  }
  const total = result.places.length;
  const choices = result.places.map((place, i) => {
    const extra: string[] = [];
    if (total > 1) {
      extra.push(`Point ${i + 1} of ${total}`);
      extra.push(`${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`);
      if (origin)
        extra.push(
          `${meters(origin, { ...place, label: place.label })} m from your start`,
        );
    }
    return choiceOf(
      place,
      "",
      `${place.label}|${place.latitude}|${place.longitude}`,
      extra,
    );
  });
  return {
    choices,
    notice:
      total > 1
        ? `${total} county address points match. The same address can appear in more than one place or at more than one point; check the city, units and point before choosing.`
        : null,
  };
}
