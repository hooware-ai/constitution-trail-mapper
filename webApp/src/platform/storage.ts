import { isDraft } from "../types";
/** Browser-only storage: no account, query, analytics or synchronization transport. */
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface Endpoint {
  label: string;
  latitude: number;
  longitude: number;
}
export interface RouteRecord {
  key: string;
  title: string;
  createdAt: number;
  usedAt: number;
  route: unknown;
  draft: unknown;
}
export interface PlaceRecord extends Endpoint {
  key: string;
  createdAt: number;
}
export interface RouteLibrary {
  version: 1;
  saved: RouteRecord[];
  recent: RouteRecord[];
  places: PlaceRecord[];
}
export type StorageIssue =
  | "unavailable"
  | "corrupt"
  | "unsupported-version"
  | "quota"
  | "invalid-record";
export interface StoreResult<T> {
  ok: boolean;
  state: T;
  error?: StorageIssue;
  /** Unreadable saved items set aside in quarantine by this read; the rest of the library is intact. */
  quarantined?: number;
  /** Unreadable saved items still in the library because they could not be set aside (no room). */
  pendingUnreadable?: number;
}
export const LIBRARY_KEY = "trail-mapper.web.library.v1";
export const QUARANTINE_KEY = "trail-mapper.web.library.quarantine.v1";
interface Rejected {
  kind: "saved" | "recent" | "places";
  record: unknown;
}
export const ACTIVE_RIDE_KEY = "trail-mapper.web.active-ride.v1";
export const RECENT_LIMIT = 20;
export const RECENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const emptyLibrary = (): RouteLibrary => ({
  version: 1,
  saved: [],
  recent: [],
  places: [],
});
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function isRoute(value: unknown): value is RouteRecord {
  return (
    object(value) &&
    text(value.key) &&
    text(value.title) &&
    finite(value.createdAt) &&
    finite(value.usedAt) &&
    value.createdAt >= 0 &&
    value.usedAt >= 0 &&
    object(value.route) &&
    isDraft(value.draft)
  );
}
function isPlace(value: unknown): value is PlaceRecord {
  return (
    object(value) &&
    text(value.key) &&
    text(value.label) &&
    finite(value.createdAt) &&
    finite(value.latitude) &&
    Math.abs(value.latitude) <= 90 &&
    finite(value.longitude) &&
    Math.abs(value.longitude) <= 180 &&
    (value.address === undefined || typeof value.address === "string")
  );
}
function writeIssue(error: unknown): StorageIssue {
  return object(error) &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ? "quota"
    : "unavailable";
}
function unique<T extends { key: string }>(records: T[]): T[] {
  const seen = new Set<string>();
  return records.filter(
    (record) => !seen.has(record.key) && !!seen.add(record.key),
  );
}
function normalize(state: RouteLibrary, now: number): RouteLibrary {
  const saved = unique([...state.saved].sort((a, b) => b.usedAt - a.usedAt));
  const savedKeys = new Set(saved.map((route) => route.key));
  return {
    version: 1,
    saved,
    places: unique(state.places),
    recent: unique(
      [...state.recent]
        .filter(
          (route) =>
            !savedKeys.has(route.key) &&
            route.usedAt > now - RECENT_MAX_AGE_MS &&
            route.usedAt <= now + 5_000,
        )
        .sort((a, b) => b.usedAt - a.usedAt),
    ).slice(0, RECENT_LIMIT),
  };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
      .join(",") +
    "}"
  );
}
/** Pass route geometry/identity only, excluding presentation timestamps and user labels. */
export function stableRouteKey(routeIdentity: unknown): string {
  const value = canonical(routeIdentity);
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(value))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return "route-" + hash.toString(16).padStart(16, "0");
}
export class LocalRouteStore {
  constructor(
    private storage: StoragePort,
    private now: () => number = Date.now,
  ) {}
  /** Pure parse: splits stored records into usable and rejected ones without writing anything. */
  private parse(): {
    result: StoreResult<RouteLibrary>;
    rejected: Rejected[];
    raw: string | null;
  } {
    let raw: string | null;
    try {
      raw = this.storage.getItem(LIBRARY_KEY);
    } catch {
      return {
        result: { ok: false, state: emptyLibrary(), error: "unavailable" },
        rejected: [],
        raw: null,
      };
    }
    if (raw === null)
      return {
        result: { ok: true, state: emptyLibrary() },
        rejected: [],
        raw,
      };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!object(parsed)) throw new Error("invalid");
      if (parsed.version !== 1)
        return {
          result: {
            ok: false,
            state: emptyLibrary(),
            error: "unsupported-version",
          },
          rejected: [],
          raw,
        };
      if (
        !Array.isArray(parsed.saved) ||
        !Array.isArray(parsed.recent) ||
        !Array.isArray(parsed.places)
      )
        throw new Error("invalid");
      const rejected: Rejected[] = [];
      const keep = <T>(
        kind: Rejected["kind"],
        items: unknown[],
        valid: (item: unknown) => item is T,
      ) =>
        items.filter((item): item is T => {
          if (valid(item)) return true;
          rejected.push({ kind, record: item });
          return false;
        });
      const state = normalize(
        {
          version: 1,
          saved: keep("saved", parsed.saved, isRoute),
          recent: keep("recent", parsed.recent, isRoute),
          places: keep("places", parsed.places, isPlace),
        },
        this.now(),
      );
      return { result: { ok: true, state }, rejected, raw };
    } catch {
      return {
        result: { ok: false, state: emptyLibrary(), error: "corrupt" },
        rejected: [],
        raw,
      };
    }
  }
  read(): StoreResult<RouteLibrary> {
    const { result, rejected, raw } = this.parse();
    if (!result.ok || raw === null) return result;
    // Only the rejected records are kept aside (never a copy of the whole library), so this
    // stays small enough to succeed on a nearly full store.
    if (rejected.length > 0) {
      try {
        this.quarantine(rejected);
      } catch (error) {
        return {
          ...result,
          ok: false,
          error: writeIssue(error),
          pendingUnreadable: rejected.length,
        };
      }
    }
    const quarantined = rejected.length > 0 ? rejected.length : undefined;
    const normalized = JSON.stringify(result.state);
    if (normalized !== raw) {
      try {
        this.storage.setItem(LIBRARY_KEY, normalized);
      } catch (error) {
        return { ...result, ok: false, error: writeIssue(error), quarantined };
      }
    }
    return quarantined ? { ...result, quarantined } : result;
  }
  private stored(): unknown[] {
    const stored = this.storage.getItem(QUARANTINE_KEY);
    if (stored === null) return [];
    try {
      const parsed: unknown = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [{ legacy: parsed }];
    } catch {
      return [{ legacy: stored }];
    }
  }
  /** Rejected records not yet safely set aside. */
  private unsetAside(rejected: Rejected[]): Rejected[] {
    let entries: unknown[];
    try {
      entries = this.stored();
    } catch {
      return rejected;
    }
    return rejected.filter(
      (item) =>
        !entries.some(
          (existing) =>
            object(existing) &&
            existing.kind === item.kind &&
            canonical(existing.record) === canonical(item.record),
        ),
    );
  }
  /** Append rejected records; nothing already set aside is ever evicted or overwritten. */
  private quarantine(rejected: Rejected[]) {
    const entries = this.stored();
    const added = this.unsetAside(rejected).map((item) => ({
      at: this.now(),
      ...item,
    }));
    if (added.length > 0)
      this.storage.setItem(
        QUARANTINE_KEY,
        JSON.stringify([...entries, ...added]),
      );
  }
  /**
   * Explicit rider action: permanently delete unreadable saved data, whether it was already set
   * aside or is still waiting in the library because there was no room to set it aside.
   * Succeeds only when nothing unreadable remains.
   */
  discardUnreadable(): StoreResult<RouteLibrary> {
    try {
      this.storage.removeItem(QUARANTINE_KEY);
    } catch (error) {
      return { ...this.parse().result, ok: false, error: writeIssue(error) };
    }
    const { result, rejected } = this.parse();
    if (!result.ok || rejected.length === 0) return result;
    try {
      this.storage.setItem(LIBRARY_KEY, JSON.stringify(result.state));
    } catch (error) {
      return {
        ...result,
        ok: false,
        error: writeIssue(error),
        pendingUnreadable: rejected.length,
      };
    }
    return result;
  }
  hasQuarantine(): boolean {
    try {
      return this.storage.getItem(QUARANTINE_KEY) !== null;
    } catch {
      return false;
    }
  }
  private change(
    apply: (state: RouteLibrary) => RouteLibrary,
  ): StoreResult<RouteLibrary> {
    const { result: current, rejected, raw } = this.parse();
    // Preserve corrupt/unknown data until the rider explicitly resets it.
    if (!current.ok) return current;
    let next: RouteLibrary;
    try {
      next = normalize(apply(current.state), this.now());
    } catch {
      return { ...current, ok: false, error: "invalid-record" };
    }
    try {
      this.storage.setItem(LIBRARY_KEY, JSON.stringify(next));
    } catch (error) {
      // The malformed bytes are still in the library: keep offering the rider the way out.
      const pending = this.unsetAside(rejected).length;
      return {
        ...current,
        ok: false,
        error: writeIssue(error),
        ...(pending > 0 ? { pendingUnreadable: pending } : {}),
      };
    }
    if (rejected.length > 0 && raw !== null) {
      try {
        this.quarantine(rejected);
      } catch (error) {
        // Never let a change silently drop unreadable data: put the previous library back.
        try {
          this.storage.setItem(LIBRARY_KEY, raw);
        } catch {
          // The previous bytes fit before this change, so restoring them failing is not expected.
        }
        return {
          ...current,
          ok: false,
          error: writeIssue(error),
          pendingUnreadable: rejected.length,
        };
      }
    }
    return { ok: true, state: next };
  }
  /** Only call after a successful route result. Never accept search terms or failed attempts. */
  recordSuccess(record: RouteRecord): StoreResult<RouteLibrary> {
    if (!isRoute(record))
      return { ...this.read(), ok: false, error: "invalid-record" };
    return this.change((state) =>
      state.saved.some((item) => item.key === record.key)
        ? state
        : {
            ...state,
            recent: [
              { ...record, usedAt: this.now() },
              ...state.recent.filter((item) => item.key !== record.key),
            ],
          },
    );
  }
  save(record: RouteRecord): StoreResult<RouteLibrary> {
    if (!isRoute(record))
      return { ...this.read(), ok: false, error: "invalid-record" };
    return this.change((state) => ({
      ...state,
      saved: [
        { ...record, usedAt: this.now() },
        ...state.saved.filter((item) => item.key !== record.key),
      ],
      recent: state.recent.filter((item) => item.key !== record.key),
    }));
  }
  /** Replace a recalculated route in its existing collection as one atomic storage write. */
  replace(oldKey: string, record: RouteRecord): StoreResult<RouteLibrary> {
    if (!isRoute(record))
      return { ...this.read(), ok: false, error: "invalid-record" };
    return this.change((state) => {
      const saved = state.saved.some(
        (item) => item.key === oldKey || item.key === record.key,
      );
      const next = { ...record, usedAt: this.now() };
      const without = (items: RouteRecord[]) =>
        items.filter((item) => item.key !== oldKey && item.key !== record.key);
      return {
        ...state,
        saved: saved ? [next, ...without(state.saved)] : without(state.saved),
        recent: saved
          ? without(state.recent)
          : [next, ...without(state.recent)],
      };
    });
  }
  open(key: string): StoreResult<RouteLibrary> {
    return this.change((state) =>
      state.saved.some((item) => item.key === key)
        ? state
        : {
            ...state,
            recent: state.recent.map((item) =>
              item.key === key ? { ...item, usedAt: this.now() } : item,
            ),
          },
    );
  }
  removeRecent(key: string): StoreResult<RouteLibrary> {
    return this.change((state) => ({
      ...state,
      recent: state.recent.filter((item) => item.key !== key),
    }));
  }
  clearRecents(): StoreResult<RouteLibrary> {
    return this.change((state) => ({ ...state, recent: [] }));
  }
  deleteSaved(key: string): StoreResult<RouteLibrary> {
    return this.change((state) => ({
      ...state,
      saved: state.saved.filter((item) => item.key !== key),
    }));
  }
  rename(key: string, title: string): StoreResult<RouteLibrary> {
    if (!text(title))
      return { ...this.read(), ok: false, error: "invalid-record" };
    return this.change((state) => ({
      ...state,
      saved: state.saved.map((item) =>
        item.key === key ? { ...item, title: title.trim() } : item,
      ),
    }));
  }
  savePlace(place: PlaceRecord): StoreResult<RouteLibrary> {
    if (!isPlace(place))
      return { ...this.read(), ok: false, error: "invalid-record" };
    return this.change((state) => ({
      ...state,
      places: [place, ...state.places.filter((item) => item.key !== place.key)],
    }));
  }
  deletePlace(key: string): StoreResult<RouteLibrary> {
    return this.change((state) => ({
      ...state,
      places: state.places.filter((item) => item.key !== key),
    }));
  }
  reset(): StoreResult<RouteLibrary> {
    try {
      this.storage.removeItem(LIBRARY_KEY);
      return { ok: true, state: emptyLibrary() };
    } catch (error) {
      return { ok: false, state: this.read().state, error: writeIssue(error) };
    }
  }
}
export interface ActiveRide {
  version: 1;
  record: RouteRecord;
  routeProgressMeters: number;
  creditedDistanceMeters: number;
  updatedAt: number;
}
export class ActiveRideStore {
  constructor(private storage: StoragePort) {}
  read(): StoreResult<ActiveRide | null> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(ACTIVE_RIDE_KEY);
    } catch {
      return { ok: false, state: null, error: "unavailable" };
    }
    if (!raw) return { ok: true, state: null };
    try {
      const value: unknown = JSON.parse(raw);
      if (object(value) && value.version !== 1)
        return { ok: false, state: null, error: "unsupported-version" };
      if (
        !object(value) ||
        !isRoute(value.record) ||
        !finite(value.routeProgressMeters) ||
        value.routeProgressMeters < 0 ||
        !finite(value.creditedDistanceMeters) ||
        value.creditedDistanceMeters < 0 ||
        !finite(value.updatedAt)
      )
        throw new Error("invalid");
      return { ok: true, state: value as unknown as ActiveRide };
    } catch {
      return { ok: false, state: null, error: "corrupt" };
    }
  }
  write(ride: ActiveRide): StoreResult<ActiveRide | null> {
    const current = this.read();
    try {
      this.storage.setItem(ACTIVE_RIDE_KEY, JSON.stringify(ride));
      return { ok: true, state: ride };
    } catch (error) {
      return { ok: false, state: current.state, error: writeIssue(error) };
    }
  }
  clear(): StoreResult<ActiveRide | null> {
    try {
      this.storage.removeItem(ACTIVE_RIDE_KEY);
      return { ok: true, state: null };
    } catch (error) {
      return { ok: false, state: this.read().state, error: writeIssue(error) };
    }
  }
}
