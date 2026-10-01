// Encoded polylines for the saved-route geometry field: WGS84 degrees, latitude first, 1e-7 degree precision
// (about 1 cm), deltas zig-zagged into 5-bit groups (the familiar "encoded polyline" family, with the scale changed).
// Pure arithmetic: no bitwise operators, because 1e-7 scaled longitudes exceed 32 bits once doubled.

export const POLYLINE_SCALE = 1e7;
/** A point rounds to the nearest 1e-7 degree, so a decoded coordinate differs by at most this many degrees. */
export const POLYLINE_PRECISION_DEGREES = 0.5 / POLYLINE_SCALE;

export interface LatLon {
  latitude: number;
  longitude: number;
}

function encodeInteger(value: number): string {
  let rest = value < 0 ? -2 * value - 1 : 2 * value;
  let out = "";
  while (rest >= 32) {
    out += String.fromCharCode((rest % 32 | 32) + 63);
    rest = Math.floor(rest / 32);
  }
  return out + String.fromCharCode(rest + 63);
}

/** Encodes points in order. Every coordinate must be a finite number; the caller validates ranges. */
export function encodePath(points: readonly LatLon[]): string {
  let previousLat = 0,
    previousLon = 0,
    out = "";
  for (const point of points) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude))
      throw new RangeError("A polyline point is not a finite coordinate.");
    const lat = Math.round(point.latitude * POLYLINE_SCALE);
    const lon = Math.round(point.longitude * POLYLINE_SCALE);
    out += encodeInteger(lat - previousLat) + encodeInteger(lon - previousLon);
    previousLat = lat;
    previousLon = lon;
  }
  return out;
}

/** Decodes a path, or throws RangeError if the text is not a complete encoded polyline. */
export function decodePath(text: string): LatLon[] {
  const points: LatLon[] = [];
  let index = 0,
    lat = 0,
    lon = 0;
  const next = (): number => {
    let result = 0,
      factor = 1,
      byte: number;
    do {
      if (index >= text.length)
        throw new RangeError("The polyline ends in the middle of a value.");
      byte = text.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63)
        throw new RangeError("The polyline holds a character it cannot use.");
      result += (byte % 32) * factor;
      factor *= 32;
      if (factor > 2 ** 40)
        throw new RangeError("The polyline holds an oversized value.");
    } while (byte >= 32);
    return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
  };
  while (index < text.length) {
    lat += next();
    lon += next();
    points.push({
      latitude: lat / POLYLINE_SCALE,
      longitude: lon / POLYLINE_SCALE,
    });
  }
  return points;
}
