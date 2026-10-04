// A compact, deterministic, LOCAL address index (PROTOTYPE: not wired into the app). It reads only data it is given: no
// network, no storage, no timers, no global state. Typed text and positions never leave the device because nothing in this
// module can send them anywhere (a unit test pins that).
//
// An address point is where the county records an address (a parcel or building point). It is NOT an approved trail
// entrance and carries no connection to the trail network: whatever uses it to place a trip still meets the existing
// routing rules (mapped access, estimated gaps that block Start, closures). The matching here only helps a rider find a place.
//
// Data: McLean County "Addresses" (ArcGIS item 502eefa828f94f749bbab9da63b0d016), CC BY 4.0. See
// docs/web/address-index-prototype.md for the pinned inputs, the transform, the attribution and the measurements.

export const ADDRESS_INDEX_SCHEMA = "trail-mapper.address-index/1";
export const TRANSFORM_VERSION = "1";
const COORDINATE_SCALE = 1_000_000; // 1e-6 degrees, about 0.11 m in latitude: finer than an address point is accurate

// ---- normalization -----------------------------------------------------------------------------------------------------

/** Street-type and directional words in their one canonical (USPS-style) form; applied to typed text and to the source alike. */
const CANONICAL: Record<string, string> = {
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
  STREET: "ST",
  STR: "ST",
  AVENUE: "AVE",
  AV: "AVE",
  ROAD: "RD",
  DRIVE: "DR",
  LANE: "LN",
  BOULEVARD: "BLVD",
  BLV: "BLVD",
  COURT: "CT",
  PLACE: "PL",
  CIRCLE: "CIR",
  HIGHWAY: "HWY",
  PARKWAY: "PKWY",
  TERRACE: "TER",
  TRAIL: "TRL",
  SQUARE: "SQ",
  ALLEY: "ALY",
  EXPRESSWAY: "EXPY",
  SAINT: "ST",
  MOUNT: "MT",
  FORT: "FT",
  ROUTE: "RTE",
  COUNTY: "CO",
};
const DIRECTIONALS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

/** Upper-case tokens with punctuation removed and each word mapped to its canonical form. */
export function tokens(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s*&\s*/g, " AND ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => CANONICAL[token] ?? token);
}
const NUMBER = /^(\d+)(?:-?([A-Z])|-(\d+)|(1\/2))?$/;
/** A leading house number: its integer and its suffix ("A", "1/2", "-5"), or null when the text has none. */
export function parseNumber(
  token: string | undefined,
): { num: number; suffix: string } | null {
  const match = token ? NUMBER.exec(token) : null;
  if (!match) return null;
  return {
    num: Number(match[1]),
    suffix: match[2] ?? (match[3] ? `-${match[3]}` : (match[4] ?? "")),
  };
}

// ---- the index ------------------------------------------------------------------------------------------------------------

/** What the builder writes (all columns are parallel arrays over entries, sorted by street, number, suffix, unit, id). */
export interface AddressIndexData {
  schema: typeof ADDRESS_INDEX_SCHEMA;
  transform: string;
  cities: string[];
  zips: string[];
  suffixes: string[];
  streets: string[];
  /** CSR offsets: entries of street i are start[i] .. start[i + 1] - 1. */
  start: number[];
  num: number[];
  suffix: number[];
  city: number[];
  zip: number[];
  /** Delta-encoded 1e-6 degrees. */
  lat: number[];
  lon: number[];
  /** Delta-encoded source object ids (provenance). */
  oid: number[];
  /** Sparse: [entry, unit label]. */
  units: [number, string][];
}

export interface RawAddressRow {
  oid: number;
  address: string | null;
  building: string | null;
  unit: string | null;
  city: string | null;
  zip: string | null;
  longitude: number | null;
  latitude: number | null;
}
export interface BuildReport {
  rows: number;
  indexed: number;
  skippedNoNumber: number;
  skippedNoPoint: number;
  skippedNotMcLean: number;
  exactDuplicatesDropped: number;
  streets: number;
  cities: number;
  withUnit: number;
}

const cleanUnit = (building: string | null, unit: string | null) =>
  [
    building ? `BLDG ${building.trim().toUpperCase()}` : "",
    unit ? unit.trim().toUpperCase() : "",
  ]
    .filter(Boolean)
    .join(" ");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Builds the index data. Pure and deterministic: the same rows always give byte-identical data. */
export function buildAddressIndex(
  rows: RawAddressRow[],
  county: (row: RawAddressRow) => boolean = () => true,
): { data: AddressIndexData; report: BuildReport } {
  const report: BuildReport = {
    rows: rows.length,
    indexed: 0,
    skippedNoNumber: 0,
    skippedNoPoint: 0,
    skippedNotMcLean: 0,
    exactDuplicatesDropped: 0,
    streets: 0,
    cities: 0,
    withUnit: 0,
  };
  interface Entry {
    street: string;
    num: number;
    suffix: string;
    unit: string;
    city: string;
    zip: string;
    lat: number;
    lon: number;
    oid: number;
  }
  const entries: Entry[] = [];
  for (const row of rows) {
    if (!county(row)) {
      report.skippedNotMcLean++;
      continue;
    }
    if (row.latitude == null || row.longitude == null) {
      report.skippedNoPoint++;
      continue;
    }
    const parts = tokens(row.address ?? "");
    const number = parseNumber(parts[0]);
    if (!number || parts.length < 2) {
      report.skippedNoNumber++;
      continue;
    }
    entries.push({
      street: parts.slice(1).join(" "),
      num: number.num,
      suffix: number.suffix,
      unit: cleanUnit(row.building, row.unit),
      city: (row.city ?? "").trim().toUpperCase(),
      zip: (row.zip ?? "").trim().slice(0, 5),
      lat: Math.round(row.latitude * COORDINATE_SCALE),
      lon: Math.round(row.longitude * COORDINATE_SCALE),
      oid: row.oid,
    });
  }
  entries.sort(
    (a, b) =>
      compare(a.street, b.street) ||
      a.num - b.num ||
      compare(a.suffix, b.suffix) ||
      compare(a.unit, b.unit) ||
      compare(a.city, b.city) ||
      a.oid - b.oid,
  );
  // An exact duplicate (same place, number, suffix, unit, city AND point) adds nothing; a different point is kept, because
  // two points for one address is exactly the ambiguity a rider should be told about.
  const kept: Entry[] = [];
  for (const e of entries) {
    const last = kept[kept.length - 1];
    if (
      last &&
      last.street === e.street &&
      last.num === e.num &&
      last.suffix === e.suffix &&
      last.unit === e.unit &&
      last.city === e.city &&
      last.lat === e.lat &&
      last.lon === e.lon
    ) {
      report.exactDuplicatesDropped++;
      continue;
    }
    kept.push(e);
  }
  const cities = [...new Set(kept.map((e) => e.city))].sort(compare);
  const zips = [...new Set(kept.map((e) => e.zip))].sort(compare);
  const suffixes = [...new Set(kept.map((e) => e.suffix))].sort(compare);
  const streets: string[] = [];
  const start: number[] = [];
  const data: AddressIndexData = {
    schema: ADDRESS_INDEX_SCHEMA,
    transform: TRANSFORM_VERSION,
    cities,
    zips,
    suffixes,
    streets,
    start,
    num: [],
    suffix: [],
    city: [],
    zip: [],
    lat: [],
    lon: [],
    oid: [],
    units: [],
  };
  const cityId = new Map(cities.map((c, i) => [c, i]));
  const zipId = new Map(zips.map((z, i) => [z, i]));
  const suffixId = new Map(suffixes.map((s, i) => [s, i]));
  let previous: Entry = {
    street: "",
    num: 0,
    suffix: "",
    unit: "",
    city: "",
    zip: "",
    lat: 0,
    lon: 0,
    oid: 0,
  };
  kept.forEach((e, i) => {
    if (i === 0 || e.street !== kept[i - 1].street) {
      streets.push(e.street);
      start.push(i);
    }
    data.num.push(e.num);
    data.suffix.push(suffixId.get(e.suffix)!);
    data.city.push(cityId.get(e.city)!);
    data.zip.push(zipId.get(e.zip)!);
    data.lat.push(e.lat - previous.lat);
    data.lon.push(e.lon - previous.lon);
    data.oid.push(e.oid - previous.oid);
    if (e.unit) {
      data.units.push([i, e.unit]);
      report.withUnit++;
    }
    previous = e;
  });
  start.push(kept.length);
  report.indexed = kept.length;
  report.streets = streets.length;
  report.cities = cities.length;
  return { data, report };
}

/** The deterministic text of the index: a stable key order and no whitespace. */
export function serializeAddressIndex(data: AddressIndexData): string {
  const {
    schema,
    transform,
    cities,
    zips,
    suffixes,
    streets,
    start,
    num,
    suffix,
    city,
    zip,
    lat,
    lon,
    oid,
    units,
  } = data;
  return JSON.stringify({
    schema,
    transform,
    cities,
    zips,
    suffixes,
    streets,
    start,
    num,
    suffix,
    city,
    zip,
    lat,
    lon,
    oid,
    units,
  });
}

// ---- searching ------------------------------------------------------------------------------------------------------------

export interface AddressPlace {
  /** A readable label: "421 N Main St, Normal". */
  label: string;
  latitude: number;
  longitude: number;
  city: string;
  zip: string;
  street: string;
  number: string;
  /** Unit and building labels at this number (the point is one of them: units are not told apart on the map). */
  units: string[];
  /** The county's point for this address, not a trail entrance or a mapped connection. */
  source: "county-address-point";
}
export type AddressSearch =
  | { kind: "matches"; places: AddressPlace[]; ambiguous: boolean }
  | {
      kind: "nearest-numbers";
      street: string;
      typed: string;
      lower: AddressPlace | null;
      higher: AddressPlace | null;
    }
  | { kind: "streets"; streets: string[] }
  | { kind: "none" };

const title = (word: string) =>
  DIRECTIONALS.has(word) || /\d/.test(word)
    ? word
    : word.charAt(0) + word.slice(1).toLowerCase();
export const formatStreet = (street: string) =>
  street.split(" ").map(title).join(" ");
const formatCity = (city: string) =>
  city
    .split(" ")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");

export class AddressIndex {
  readonly size: number;
  private readonly streetTokens: string[][];
  private readonly lat: Int32Array;
  private readonly lon: Int32Array;
  private readonly oid: Int32Array;
  private readonly unitOf = new Map<number, string>();
  private grid: Map<number, number[]> | null = null;
  private static readonly CELL = 0.002; // degrees: about 220 m of latitude

  constructor(readonly data: AddressIndexData) {
    if (data.schema !== ADDRESS_INDEX_SCHEMA)
      throw new Error("This is not a Trail Mapper address index.");
    this.size = data.num.length;
    this.streetTokens = data.streets.map((s) => s.split(" "));
    const decode = (deltas: number[]) => {
      const out = new Int32Array(deltas.length);
      let value = 0;
      for (let i = 0; i < deltas.length; i++) out[i] = value += deltas[i];
      return out;
    };
    this.lat = decode(data.lat);
    this.lon = decode(data.lon);
    this.oid = decode(data.oid);
    for (const [entry, unit] of data.units) this.unitOf.set(entry, unit);
  }

  private streetOf(entry: number): number {
    const { start } = this.data;
    let lo = 0,
      hi = start.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (start[mid] <= entry) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  private place(
    entry: number,
    street: number,
    units: string[] = [],
  ): AddressPlace {
    const d = this.data;
    const suffix = d.suffixes[d.suffix[entry]];
    const number = `${d.num[entry]}${suffix === "1/2" ? " 1/2" : suffix}`;
    const city = formatCity(d.cities[d.city[entry]]);
    return {
      label: `${number} ${formatStreet(d.streets[street])}${city ? `, ${city}` : ""}`,
      latitude: this.lat[entry] / COORDINATE_SCALE,
      longitude: this.lon[entry] / COORDINATE_SCALE,
      city,
      zip: d.zips[d.zip[entry]],
      street: formatStreet(d.streets[street]),
      number,
      units,
      source: "county-address-point",
    };
  }

  /** Streets matching typed street tokens: all but the last token exactly, the last as a prefix; a leading directional may be left out. */
  private matchStreets(typed: string[]): number[] {
    const found: { street: number; rank: number }[] = [];
    const last = typed.length - 1;
    for (let s = 0; s < this.streetTokens.length; s++) {
      const name = this.streetTokens[s];
      for (const offset of name.length > 1 &&
      DIRECTIONALS.has(name[0]) &&
      !(typed[0] === name[0])
        ? [0, 1]
        : [0]) {
        if (typed.length + offset > name.length) continue;
        let ok = true;
        for (let i = 0; i < typed.length && ok; i++) {
          const candidate = name[offset + i];
          ok =
            i === last
              ? candidate.startsWith(typed[i])
              : candidate === typed[i];
        }
        if (ok) {
          const exact =
            typed.length + offset === name.length &&
            name[offset + last] === typed[last];
          found.push({
            street: s,
            rank:
              (exact ? 0 : 1000) +
              (name.length - typed.length - offset) * 10 +
              offset,
          });
          break;
        }
      }
    }
    return found
      .sort((a, b) => a.rank - b.rank || a.street - b.street)
      .map((f) => f.street);
  }

  /** Typed text to places. `limit` bounds the places returned. */
  search(text: string, limit = 8): AddressSearch {
    const parts = tokens(text);
    if (parts.length === 0) return { kind: "none" };
    const number = parseNumber(parts[0]);
    const typedStreet = number ? parts.slice(1) : parts;
    if (typedStreet.length === 0) return { kind: "none" };
    const streets = this.matchStreets(typedStreet);
    if (streets.length === 0) return { kind: "none" };
    if (!number)
      return {
        kind: "streets",
        streets: streets
          .slice(0, limit)
          .map((s) => formatStreet(this.data.streets[s])),
      };
    const d = this.data;
    const wanted = d.suffixes.indexOf(number.suffix);
    const places: AddressPlace[] = [];
    for (const street of streets) {
      for (
        let e = d.start[street];
        e < d.start[street + 1] && places.length < limit * 4;
        e++
      ) {
        if (d.num[e] !== number.num || d.suffix[e] !== wanted) continue;
        // Entries of one number, suffix and city are one place; their unit labels are listed.
        const same = places.find(
          (p) =>
            p.city === formatCity(d.cities[d.city[e]]) &&
            p.street === formatStreet(d.streets[street]) &&
            p.number === this.place(e, street).number,
        );
        const unit = this.unitOf.get(e);
        if (same) {
          if (unit && !same.units.includes(unit)) same.units.push(unit);
          continue;
        }
        places.push(this.place(e, street, unit ? [unit] : []));
      }
    }
    if (places.length > 0)
      return {
        kind: "matches",
        places: places.slice(0, limit),
        ambiguous: places.length > 1,
      };
    // The number is not on the street. With several streets of that name no single "nearest" is honest, so list them;
    // with one, report the nearest numbers either side, never a guessed point.
    if (streets.length > 1)
      return {
        kind: "streets",
        streets: streets.slice(0, limit).map((s) => formatStreet(d.streets[s])),
      };
    const street = streets[0];
    let lower: number | null = null,
      higher: number | null = null;
    for (let e = d.start[street]; e < d.start[street + 1]; e++) {
      if (d.num[e] < number.num) lower = e;
      else if (d.num[e] > number.num) {
        higher = e;
        break;
      }
    }
    return {
      kind: "nearest-numbers",
      street: formatStreet(d.streets[street]),
      typed: `${number.num}${number.suffix}`,
      lower: lower === null ? null : this.place(lower, street),
      higher: higher === null ? null : this.place(higher, street),
    };
  }

  // ---- reverse label ----------------------------------------------------------------------------------------------------

  private cellKey(latCell: number, lonCell: number) {
    return latCell * 100003 + lonCell;
  }
  private ensureGrid() {
    if (this.grid) return this.grid;
    const grid = new Map<number, number[]>();
    const cell = AddressIndex.CELL * COORDINATE_SCALE;
    for (let e = 0; e < this.size; e++) {
      const key = this.cellKey(
        Math.floor(this.lat[e] / cell),
        Math.floor(this.lon[e] / cell),
      );
      const list = grid.get(key);
      if (list) list.push(e);
      else grid.set(key, [e]);
    }
    return (this.grid = grid);
  }
  /**
   * The nearest address point within `maxMeters` (default 75 m), as a label for a map point. It names where the point is
   * near; it does not say the point is an entrance or connected to anything. Null when nothing is that close (the caller
   * keeps its existing label).
   */
  nearest(
    point: { latitude: number; longitude: number },
    maxMeters = 75,
  ): (AddressPlace & { distanceMeters: number }) | null {
    const grid = this.ensureGrid();
    const cell = AddressIndex.CELL * COORDINATE_SCALE;
    const latU = Math.round(point.latitude * COORDINATE_SCALE);
    const lonU = Math.round(point.longitude * COORDINATE_SCALE);
    const latCell = Math.floor(latU / cell),
      lonCell = Math.floor(lonU / cell);
    const metersPerLat = 111_194.93;
    const metersPerLon =
      metersPerLat * Math.cos((point.latitude * Math.PI) / 180);
    const reach = Math.ceil(maxMeters / (AddressIndex.CELL * metersPerLon));
    let best = -1,
      bestDistance = Infinity;
    for (let a = latCell - 1; a <= latCell + 1; a++)
      for (
        let b = lonCell - Math.max(1, reach);
        b <= lonCell + Math.max(1, reach);
        b++
      )
        for (const e of grid.get(this.cellKey(a, b)) ?? []) {
          const dy = ((this.lat[e] - latU) / COORDINATE_SCALE) * metersPerLat;
          const dx = ((this.lon[e] - lonU) / COORDINATE_SCALE) * metersPerLon;
          const distance = Math.hypot(dx, dy);
          if (
            distance < bestDistance ||
            (distance === bestDistance && e < best)
          ) {
            best = e;
            bestDistance = distance;
          }
        }
    if (best < 0 || bestDistance > maxMeters) return null;
    const street = this.streetOf(best);
    const unit = this.unitOf.get(best);
    return {
      ...this.place(best, street, unit ? [unit] : []),
      distanceMeters: Math.round(bestDistance * 10) / 10,
    };
  }
}
