import {
  ActiveRideStore,
  type RouteRecord,
  type StorageIssue,
} from "./storage";
import { ForegroundWakeLock, type WakeLockStatus } from "./wakeLock";
export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  /** Browser motion heading and speed are optional, and never decide route matching or safety. */
  heading?: number | null;
  speed?: number | null;
}
export interface LocationFailure {
  code: number;
  message?: string;
}
export interface LocationPort {
  watch(
    success: (fix: LocationFix) => void,
    failure: (error: LocationFailure) => void,
  ): number;
  clearWatch(id: number): void;
}
export interface NavigationClock {
  now(): number;
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(id: unknown): void;
}
export interface NavigationGuidance {
  routeProgressMeters: number;
  distanceFromRouteMeters: number;
  instruction: string;
  remainingMeters: number;
  [key: string]: unknown;
}
export type NavigationPhase =
  | "idle"
  | "reacquiring"
  | "navigating"
  | "off-route"
  | "location-lost"
  | "permission-denied"
  | "unsupported"
  | "paused";
export interface NavigationState {
  phase: NavigationPhase;
  message: string;
  record: RouteRecord | null;
  fix: LocationFix | null;
  guidance: NavigationGuidance | null;
  routeProgressMeters: number;
  /** How far along the CURRENT route the rider has credibly ridden (native's ridden progress); a rejoin starts here. */
  riddenMeters: number;
  creditedDistanceMeters: number;
  wakeLock: WakeLockStatus;
  storageError?: StorageIssue;
}
export interface NavigationDependencies {
  location?: LocationPort;
  clock?: NavigationClock;
  storage?: ActiveRideStore;
  wakeLock?: ForegroundWakeLock;
  onAccepted?: (guidance: NavigationGuidance) => void;
  /**
   * An exercise loop was genuinely completed (the shared completion rule: departed, enough verified progress, back at the
   * finish). Called once per ride; the app records the ride and ends navigation.
   */
  onArrived?: (record: RouteRecord) => void;
  evaluate: (
    route: unknown,
    fix: LocationFix,
    context: {
      resume: boolean;
      previousProgress: number;
      /** Where ridden progress stands (a restored ride's saved value); the router uses it before its own state exists. */
      previousRidden: number;
    },
  ) => Promise<NavigationGuidance>;
}
export const MAX_FIX_AGE_MS = 15_000;
/** A reroute computed for a rider who has since moved further than this is not for where they are now. */
export const REROUTE_MAX_DRIFT_METERS = 100;
export const MAX_FIX_ACCURACY_METERS = 35;
const FUTURE_TOLERANCE_MS = 5_000;
const DEVIATION_MIN_GAP_MS = 4_000;
const defaultClock: NavigationClock = {
  now: Date.now,
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (id) =>
    globalThis.clearInterval(id as ReturnType<typeof setInterval>),
};
export function usableFix(fix: LocationFix, now: number): boolean {
  return (
    [fix.latitude, fix.longitude, fix.accuracy, fix.timestamp].every(
      Number.isFinite,
    ) &&
    Math.abs(fix.latitude) <= 90 &&
    Math.abs(fix.longitude) <= 180 &&
    fix.accuracy >= 0 &&
    fix.accuracy <= MAX_FIX_ACCURACY_METERS &&
    now - fix.timestamp <= MAX_FIX_AGE_MS &&
    fix.timestamp - now <= FUTURE_TOLERANCE_MS
  );
}
const initialState = (wakeLock: WakeLockStatus): NavigationState => ({
  phase: "idle",
  message: "",
  record: null,
  fix: null,
  guidance: null,
  routeProgressMeters: 0,
  riddenMeters: 0,
  creditedDistanceMeters: 0,
  wakeLock,
});
function distanceMeters(a: LocationFix, b: LocationFix): number {
  const rad = Math.PI / 180,
    dLat = (b.latitude - a.latitude) * rad,
    dLon = (b.longitude - a.longitude) * rad,
    h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.latitude * rad) *
        Math.cos(b.latitude * rad) *
        Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** What a reroute was computed against; compare with `rerouteStaleReason` before adopting it. */
export interface RerouteRequest {
  recordKey: string;
  record: RouteRecord;
  epoch: number;
  fix: LocationFix;
  progress: number;
  /** Where a rejoin or a carried ride is measured from (see NavigationState.riddenMeters). */
  riddenMeters: number;
}
export type RerouteStaleReason =
  | "ride-changed"
  | "interrupted"
  | "location-lost"
  | "back-on-route"
  | "moved";
/** Foreground-only orchestration. Matching and route instructions are supplied by shared Kotlin. */
export class ForegroundNavigationController {
  state: NavigationState;
  private clock: NavigationClock;
  private visible = true;
  private generation = 0;
  private sequence = 0;
  /** Changes whenever guidance is discarded (restart, stop, hide/show, location loss), never on accepted fixes. */
  private epoch = 0;
  private watchId: number | null = null;
  private timer: unknown;
  private watchStartedAt = 0;
  private lastTimestamp = -Infinity;
  private lastProgress: number | null = null;
  private needsReacquisition = true;
  private completionReported = false;
  private offRouteSince: number | null = null;
  private confirmedOffRoute = false;
  private listeners = new Set<(state: NavigationState) => void>();
  private pendingEvaluations = 0;
  private settleWaiters: Array<() => void> = [];
  private unwatchWake?: () => void;
  constructor(private deps: NavigationDependencies) {
    this.clock = deps.clock ?? defaultClock;
    this.state = initialState(deps.wakeLock?.status ?? "unsupported");
    this.unwatchWake = deps.wakeLock?.subscribe((status) => {
      this.state = { ...this.state, wakeLock: status };
      this.emit();
    });
  }
  subscribe(listener: (state: NavigationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }
  private patch(patch: Partial<NavigationState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }
  start(
    record: RouteRecord,
    initialProgress = 0,
    creditedDistance = 0,
    initialRidden?: number,
  ): void {
    this.invalidate();
    this.completionReported = false;
    this.state = {
      ...initialState(this.state.wakeLock),
      record,
      routeProgressMeters: Math.max(0, initialProgress),
      // A restored ride resumes from its saved progress; a fresh route (reroute, reverse, new ride) starts from zero.
      // A restored ride resumes from its saved ridden progress. One saved before that was kept falls back to the LESSER of
      // the matched progress and the observed distance: never more than was credibly covered (an off-route projection can
      // only have inflated the matched progress), and a rejoin from there errs toward riding more of the loop.
      riddenMeters: Math.max(
        0,
        initialRidden ?? Math.min(initialProgress, creditedDistance),
      ),
      creditedDistanceMeters: Math.max(0, creditedDistance),
    };
    this.persist();
    this.deps.wakeLock?.setActive(true);
    if (this.visible) this.acquire();
    else
      this.patch({
        phase: "paused",
        message: "Navigation paused while this page is hidden.",
      });
  }
  /**
   * Swap the route of the current ride (reroute, rejoin, return to start). Route-relative progress starts
   * over on the new geometry, but the ride's observed-distance total is the same ride's and carries over.
   * Use `start()` for an explicitly new ride.
   */
  replaceRoute(record: RouteRecord): void {
    this.start(record, 0, this.state.creditedDistanceMeters);
  }
  restore(): RouteRecord | null {
    const stored = this.deps.storage?.read();
    if (!stored) return null;
    if (!stored.ok) {
      this.patch({ storageError: stored.error });
      return null;
    }
    if (!stored.state) return null;
    this.start(
      stored.state.record,
      stored.state.routeProgressMeters,
      stored.state.creditedDistanceMeters,
      stored.state.riddenMeters,
    );
    return stored.state.record;
  }
  stop(): void {
    this.invalidate();
    this.deps.wakeLock?.setActive(false);
    const result = this.deps.storage?.clear();
    this.state = {
      ...initialState(this.state.wakeLock),
      storageError: result?.ok === false ? result.error : undefined,
    };
    this.emit();
  }
  /** Route matching is offline: drop live guidance now, keep route/progress/credit, and re-evaluate on the next fix. */
  routingUnavailable(): void {
    if (!this.state.record || this.state.phase === "idle") return;
    this.lose(
      "location-lost",
      "Route guidance is unavailable. Restart route planning to continue.",
    );
  }
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.deps.wakeLock?.setVisible(visible);
    if (!this.state.record) return;
    this.invalidate();
    if (visible) this.acquire();
    else {
      this.patch({
        phase: "paused",
        message: "Navigation paused while this page is hidden.",
        fix: null,
        guidance: null,
      });
      this.persist();
    }
  }
  /** Snapshot for an asynchronous reroute; null unless the rider is confirmed off route with a credible fix. */
  rerouteRequest(): RerouteRequest | null {
    const { record, fix, phase } = this.state;
    if (!record || !fix || phase !== "off-route") return null;
    if (!usableFix(fix, this.clock.now())) return null;
    return {
      recordKey: record.key,
      record,
      epoch: this.epoch,
      fix,
      progress: this.state.routeProgressMeters,
      riddenMeters: this.state.riddenMeters,
    };
  }
  /** Why a delayed reroute must not replace the active route, or null when it still applies. */
  rerouteStaleReason(request: RerouteRequest): RerouteStaleReason | null {
    const { record, fix, phase } = this.state;
    if (!record || record.key !== request.recordKey) return "ride-changed";
    if (this.epoch !== request.epoch) return "interrupted";
    if (!fix || !usableFix(fix, this.clock.now())) return "location-lost";
    if (phase !== "off-route") return "back-on-route";
    if (distanceMeters(request.fix, fix) > REROUTE_MAX_DRIFT_METERS)
      return "moved";
    return null;
  }
  private invalidate(): void {
    ++this.generation;
    ++this.sequence;
    ++this.epoch;
    if (this.watchId !== null) this.deps.location?.clearWatch(this.watchId);
    this.watchId = null;
    if (this.timer !== undefined) this.clock.clearInterval(this.timer);
    this.timer = undefined;
    this.lastTimestamp = -Infinity;
    this.lastProgress = null;
    this.needsReacquisition = true;
    this.offRouteSince = null;
    this.confirmedOffRoute = false;
  }
  private acquire(): void {
    this.watchStartedAt = this.clock.now();
    this.patch({
      phase: this.deps.location ? "reacquiring" : "unsupported",
      message: this.deps.location
        ? "Reacquiring location…"
        : "Location is unavailable in this browser.",
      fix: null,
      guidance: null,
    });
    if (!this.deps.location) return;
    const generation = this.generation;
    try {
      this.watchId = this.deps.location.watch(
        (fix) => {
          void this.receive(fix, generation);
        },
        (error) => {
          if (generation !== this.generation) return;
          this.lose(
            error.code === 1 ? "permission-denied" : "location-lost",
            error.code === 1
              ? "Location permission denied. Allow location to navigate."
              : "Location lost. Waiting for a fresh, accurate fix.",
          );
        },
      );
    } catch {
      this.lose("location-lost", "Location could not start in this browser.");
      return;
    }
    this.timer = this.clock.setInterval(() => {
      if (
        generation !== this.generation ||
        !this.visible ||
        this.state.phase === "permission-denied"
      )
        return;
      const timestamp = this.state.fix?.timestamp ?? this.watchStartedAt;
      if (this.clock.now() - timestamp > MAX_FIX_AGE_MS)
        this.lose(
          "location-lost",
          "Location lost. Waiting for a fresh, accurate fix.",
        );
    }, 1_000);
  }
  private lose(phase: NavigationPhase, message: string): void {
    ++this.sequence;
    ++this.epoch;
    this.lastProgress = null;
    this.needsReacquisition = true;
    this.offRouteSince = null;
    this.confirmedOffRoute = false;
    this.patch({ phase, message, fix: null, guidance: null });
  }
  /**
   * Resolves true once no location fix is waiting for its evaluation, so a newer position that queued
   * behind other worker work is reflected in the state; false if that takes longer than `timeoutMs`.
   */
  whenEvaluationsSettled(timeoutMs = 2_000): Promise<boolean> {
    if (this.pendingEvaluations === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.settleWaiters = this.settleWaiters.filter((w) => w !== done);
        resolve(false);
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.settleWaiters.push(done);
    });
  }
  private async receive(fix: LocationFix, generation: number): Promise<void> {
    ++this.pendingEvaluations;
    try {
      await this.evaluateFix(fix, generation);
    } finally {
      if (--this.pendingEvaluations === 0)
        this.settleWaiters.splice(0).forEach((done) => done());
    }
  }
  private async evaluateFix(
    fix: LocationFix,
    generation: number,
  ): Promise<void> {
    if (generation !== this.generation || !this.visible || !this.state.record)
      return;
    if (
      !usableFix(fix, this.clock.now()) ||
      fix.timestamp < this.watchStartedAt ||
      fix.timestamp <= this.lastTimestamp
    ) {
      // An unusable current reading invalidates stale turn instructions immediately.
      if (fix.timestamp > this.lastTimestamp)
        this.lose(
          "location-lost",
          "Waiting for a fresh location with accuracy within 35 m.",
        );
      return;
    }
    const sequence = ++this.sequence;
    this.lastTimestamp = fix.timestamp;
    const resume = this.needsReacquisition;
    try {
      const guidance = await this.deps.evaluate(this.state.record.route, fix, {
        resume,
        previousProgress: this.state.routeProgressMeters,
        previousRidden: this.state.riddenMeters,
      });
      if (
        generation !== this.generation ||
        sequence !== this.sequence ||
        !this.visible ||
        !usableFix(fix, this.clock.now())
      )
        return;
      // Reacquired where the loop could equally be an earlier pass: do not steer, credit or claim off route.
      if (guidance.ambiguous === true) {
        this.lastProgress = null;
        this.needsReacquisition = true;
        this.patch({
          phase: "reacquiring",
          message:
            "We can't tell where you are on the loop yet. Keep going along the route and guidance will resume once your position is clear.",
          fix,
          guidance: null,
        });
        return;
      }
      if (
        ![
          guidance.routeProgressMeters,
          guidance.remainingMeters,
          guidance.distanceFromRouteMeters,
        ].every((value) => Number.isFinite(value) && value >= 0)
      )
        throw new Error("Invalid navigation snapshot");
      const wasConfirmedOffRoute = this.confirmedOffRoute;
      const deviated =
        guidance.distanceFromRouteMeters > Math.max(45, fix.accuracy * 2);
      if (deviated) {
        if (this.offRouteSince === null) this.offRouteSince = fix.timestamp;
        else if (fix.timestamp - this.offRouteSince >= DEVIATION_MIN_GAP_MS)
          this.confirmedOffRoute = true;
      } else {
        this.offRouteSince = null;
        this.confirmedOffRoute = false;
      }
      // Native shared deviation logic is authoritative when the worker supplies it.
      if (typeof guidance.offRoute === "boolean")
        this.confirmedOffRoute = guidance.offRoute;
      // Rejoining ends the off-route episode: a reroute chosen for it must not revive on a later departure.
      if (wasConfirmedOffRoute && !this.confirmedOffRoute) ++this.epoch;
      this.deps.onAccepted?.(guidance);
      this.needsReacquisition = false;
      // Never credit a jump across hidden/invalid periods, or movement outside the matched route.
      const delta =
        this.lastProgress === null || deviated
          ? 0
          : Math.max(0, guidance.routeProgressMeters - this.lastProgress);
      this.lastProgress = deviated ? null : guidance.routeProgressMeters;
      this.patch({
        phase: this.confirmedOffRoute ? "off-route" : "navigating",
        message: this.confirmedOffRoute
          ? "Off route. Choose a reroute when safe."
          : deviated
            ? "Checking whether you are off route…"
            : "",
        fix,
        guidance: deviated ? null : guidance,
        routeProgressMeters: guidance.routeProgressMeters,
        riddenMeters:
          typeof guidance.ridden === "number" &&
          Number.isFinite(guidance.ridden) &&
          guidance.ridden >= 0
            ? guidance.ridden
            : this.state.riddenMeters,
        creditedDistanceMeters: this.state.creditedDistanceMeters + delta,
      });
      this.persist();
      const finished = this.state.record;
      if (
        guidance.arrived === true &&
        !deviated &&
        !this.completionReported &&
        finished &&
        (finished.route as { kind?: string } | null)?.kind === "ExerciseLoop"
      ) {
        this.completionReported = true;
        this.deps.onArrived?.(finished);
      }
    } catch {
      if (generation === this.generation && sequence === this.sequence)
        this.lose(
          "location-lost",
          "Route guidance is unavailable. Waiting for location to recover.",
        );
    }
  }
  private persist(): void {
    if (!this.state.record || !this.deps.storage) return;
    const result = this.deps.storage.write({
      version: 1,
      record: this.state.record,
      routeProgressMeters: this.state.routeProgressMeters,
      riddenMeters: this.state.riddenMeters,
      creditedDistanceMeters: this.state.creditedDistanceMeters,
      updatedAt: this.clock.now(),
    });
    this.patch({ storageError: result.ok ? undefined : result.error });
  }
  dispose(): void {
    this.invalidate();
    this.unwatchWake?.();
    this.deps.wakeLock?.dispose();
    this.listeners.clear();
  }
}
export function browserLocationPort(geolocation: Geolocation): LocationPort {
  return {
    watch: (success, failure) =>
      geolocation.watchPosition(
        (position) =>
          success({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
            heading: position.coords.heading,
            speed: position.coords.speed,
          }),
        failure,
        { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_FIX_AGE_MS },
      ),
    clearWatch: (id) => geolocation.clearWatch(id),
  };
}
/** Call once from the entry point and dispose when it unmounts. pagehide covers bfcache. */
export function bindNavigationLifecycle(
  controller: ForegroundNavigationController,
  page: Document = document,
  host: Window = window,
): () => void {
  const visibility = () =>
    controller.setVisible(page.visibilityState === "visible");
  const hide = () => controller.setVisible(false);
  page.addEventListener("visibilitychange", visibility);
  host.addEventListener("pagehide", hide);
  host.addEventListener("pageshow", visibility);
  visibility();
  return () => {
    page.removeEventListener("visibilitychange", visibility);
    host.removeEventListener("pagehide", hide);
    host.removeEventListener("pageshow", visibility);
  };
}
