import {
  DatasetError,
  type AccessDescriptor,
  type AccessPartRef,
} from "./dataset";

// Lazy, hash-verified delivery of the endpoint-local service roads (see tools/lib/access-package.mjs for the format and
// the equivalence argument). The base roads arrive with the dataset; service-road tiles arrive only for the cells around
// a trip's endpoints, each verified against the SHA-256 the (pinned) dataset record committed to before the router sees
// a byte of it. The router then applies its own exact 600 m filter, unchanged.

interface TileEntry extends AccessPartRef {
  lat: number;
  lon: number;
  featureCount: number;
}
export interface Point {
  latitude: number;
  longitude: number;
}

/** The same arithmetic as tools/lib/access-package.mjs `cellOf`; a unit test pins the two together. */
export const CELLS_PER_DEGREE = 100;
export const cellOf = (point: Point): [number, number] => [
  Math.floor(point.latitude * CELLS_PER_DEGREE),
  Math.floor(point.longitude * CELLS_PER_DEGREE),
];
export const cellKey = (lat: number, lon: number) => `${lat}_${lon}`;

/** The (2w+1) x (2w+1) block of cells around each point, without repeats. */
export function requiredCells(
  points: Point[],
  windowCells: number,
): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const point of points) {
    const [lat, lon] = cellOf(point);
    for (let dLat = -windowCells; dLat <= windowCells; dLat++)
      for (let dLon = -windowCells; dLon <= windowCells; dLon++)
        seen.set(cellKey(lat + dLat, lon + dLon), [lat + dLat, lon + dLon]);
  }
  return [...seen.values()];
}

const validPoint = (value: unknown): value is Point =>
  !!value &&
  typeof value === "object" &&
  Number.isFinite((value as Point).latitude) &&
  Number.isFinite((value as Point).longitude);

/** Operations whose answer depends on the loaded access roads. A map tap preview does not. */
const ACCESS_OPS = new Set([
  "plan",
  "reroute",
  "recalculate",
  "inspect",
  "snapshot",
  "reverse",
]);
export const needsAccess = (request: { op?: unknown }) =>
  typeof request.op === "string" && ACCESS_OPS.has(request.op);

/**
 * Every place the core may build road access around for this request: the trip's start and destination, a reroute's
 * current position, and a saved or restored route's own first and last points (that is where the planner built its
 * access, so that is where revalidation must see the same roads). Always all of them: nothing is skipped because a
 * point happens to be on a trail.
 */
export function accessPointsOf(request: Record<string, unknown>): Point[] {
  const points: Point[] = [];
  for (const key of ["start", "destination", "point"])
    if (validPoint(request[key])) points.push(request[key] as Point);
  const route = request.route as
    | { segments?: { points?: unknown[] }[] }
    | undefined;
  const segments = route?.segments ?? [];
  const first = segments[0]?.points?.[0];
  const last = segments.at(-1)?.points?.at(-1);
  if (validPoint(first)) points.push(first);
  if (validPoint(last)) points.push(last);
  return points;
}

export interface AccessDeps {
  fetchBytes(file: string): Promise<ArrayBuffer>;
  sha256Hex(bytes: ArrayBuffer): Promise<string>;
  /** The routing core's dispatch (JSON in, JSON out). */
  dispatch(request: Record<string, unknown>): { ok?: boolean; error?: string };
}

const MAX_PARALLEL_TILES = 6;
const decoder = new TextDecoder("utf-8");

export class AccessLoader {
  private index: Promise<Map<string, TileEntry>> | null = null;
  private loaded = new Set<string>();
  private inFlight = new Map<string, Promise<void>>();
  /** What was fetched (not cached): the bytes and files a trip needed, for the size audit and the tests. */
  readonly fetched: { file: string; bytes: number }[] = [];

  constructor(
    readonly descriptor: Omit<AccessDescriptor, "combinedSha256">,
    private deps: AccessDeps,
  ) {}

  /** The base roads, verified. Needed by every plan, so it is given to `initialize` with the trails. */
  async baseText(): Promise<string> {
    return this.verifiedText(this.descriptor.base, "The base road data");
  }

  get loadedCells(): string[] {
    return [...this.loaded].sort();
  }

  /** Makes the roads around [points] available to the core before the request that needs them is dispatched. */
  async ensure(points: Point[]): Promise<void> {
    if (points.length === 0) return;
    const index = await this.tileIndex();
    const wanted = requiredCells(points, this.descriptor.windowCells)
      .map(([lat, lon]) => index.get(cellKey(lat, lon)))
      .filter((tile): tile is TileEntry => !!tile)
      .filter((tile) => !this.loaded.has(cellKey(tile.lat, tile.lon)));
    for (let at = 0; at < wanted.length; at += MAX_PARALLEL_TILES) {
      // Every sibling settles before this call returns or throws. A rejected Promise.all would hand the session back
      // while a slower sibling is still downloading, and that sibling's addAccess would then land between two other
      // operations. Waiting costs nothing the next attempt would not have paid, and a verified sibling stays loaded.
      const results = await Promise.allSettled(
        wanted
          .slice(at, at + MAX_PARALLEL_TILES)
          .map((tile) => this.load(tile)),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;
    }
  }

  private load(tile: TileEntry): Promise<void> {
    const key = cellKey(tile.lat, tile.lon);
    const running = this.inFlight.get(key);
    if (running) return running;
    const attempt = (async () => {
      const text = await this.verifiedText(tile, "Road data for this area");
      const result = this.deps.dispatch({ op: "addAccess", access: text });
      if (result.ok === false)
        throw new DatasetError(
          "data-corrupt",
          `Road data for this area could not be used (${result.error ?? "unknown reason"}). Reload the page.`,
        );
      // Recorded only after the core accepted it, so a failed load is retried and never half-counted.
      this.loaded.add(key);
    })().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, attempt);
    return attempt;
  }

  /** Refresh preparation validates the mandatory index before a new router can be adopted. */
  async validateIndex(): Promise<void> {
    await this.tileIndex();
  }

  private tileIndex(): Promise<Map<string, TileEntry>> {
    if (!this.index) {
      this.index = this.readIndex().catch((error) => {
        this.index = null; // a failed index is retried, never remembered
        throw error;
      });
    }
    return this.index;
  }

  private async readIndex(): Promise<Map<string, TileEntry>> {
    const text = await this.verifiedText(
      this.descriptor.index,
      "The road data index",
    );
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new DatasetError(
        "data-corrupt",
        "The road data index is not readable. Reload the page.",
      );
    }
    const d = this.descriptor;
    const tiles: unknown = parsed?.tiles;
    if (
      parsed?.schema !== "trail-mapper.access-index/1" ||
      parsed.cellDegrees !== d.cellDegrees ||
      parsed.windowCells !== d.windowCells ||
      parsed.radiusMeters !== d.radiusMeters ||
      parsed.base?.sha256 !== d.base.sha256 ||
      !Array.isArray(tiles) ||
      tiles.length !== d.index.tileCount
    )
      throw new DatasetError(
        "data-corrupt",
        "The road data index does not match the trail data it belongs to. Reload the page.",
      );
    const map = new Map<string, TileEntry>();
    for (const tile of tiles as TileEntry[]) {
      if (
        !Number.isInteger(tile?.lat) ||
        !Number.isInteger(tile?.lon) ||
        typeof tile.file !== "string" ||
        !/^[0-9a-f]{64}$/.test(tile.sha256) ||
        !Number.isInteger(tile.bytes) ||
        !tile.file.includes(tile.sha256.slice(0, 12)) ||
        tile.file.includes("/") ||
        tile.file.includes("..")
      )
        throw new DatasetError(
          "data-corrupt",
          "The road data index is malformed. Reload the page.",
        );
      map.set(cellKey(tile.lat, tile.lon), tile);
    }
    return map;
  }

  /** Fetches [part] from the site, and returns its text only if the size and SHA-256 are exactly what was recorded. */
  private async verifiedText(
    part: AccessPartRef,
    what: string,
  ): Promise<string> {
    let bytes: ArrayBuffer;
    try {
      bytes = await this.deps.fetchBytes(part.file);
    } catch (error) {
      if (error instanceof DatasetError) throw error;
      throw new DatasetError(
        "data-unavailable",
        `${what} could not be downloaded. Check your connection and retry.`,
      );
    }
    this.fetched.push({ file: part.file, bytes: bytes.byteLength });
    if (
      bytes.byteLength !== part.bytes ||
      (await this.deps.sha256Hex(bytes)) !== part.sha256
    )
      throw new DatasetError(
        "data-corrupt",
        `${what} failed its integrity check, so it was not used. Retry; if it persists the site needs attention.`,
      );
    return decoder.decode(bytes);
  }
}

/**
 * One boot's operations, run strictly one at a time: an operation's road loading and its dispatch are a single step, so
 * another operation's addAccess can never land between them (a route is planned and re-checked on one road snapshot),
 * and a failure of one operation (a tile that would not download) never poisons the queue for the next. A worker
 * restart or cancellation discards this object with the worker; the replacement boots from the pinned record.
 */
export class AccessSession<T = unknown> {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private loader: AccessLoader | null,
    private dispatch: (request: Record<string, unknown>) => T,
  ) {}

  run(request: Record<string, unknown>): Promise<T> {
    const step = this.tail.then(async () => {
      if (this.loader && needsAccess(request))
        await this.loader.ensure(accessPointsOf(request));
      return this.dispatch(request);
    });
    this.tail = step.catch(() => undefined);
    return step;
  }
}
