import { DatasetError } from "../dataset";
import {
  assertSafeSuccessor,
  assertManifestClock,
  parseSafetyHistory,
  canonical,
  parseRefreshManifest,
  staleSources,
  type RefreshManifest,
} from "./manifest";

export type RefreshTrigger =
  | "launch"
  | "resume"
  | "manual"
  | "tab"
  | "online"
  | "start";
export interface PreparedData<T> {
  manifest: RefreshManifest;
  value: T;
  dispose(): void;
}
export interface RefreshDependencies<T> {
  /** Must fetch mutable release description with no-store and a bounded timeout. */
  readManifest(signal: AbortSignal): Promise<unknown>;
  /** Prepare a separate router, verify ALL mandatory parts and the closure catalog before returning. */
  prepare(
    manifest: RefreshManifest,
    signal: AbortSignal,
  ): Promise<PreparedData<T>>;
  /** Optional convenience cache. Never authority for Start; failures are visible but do not undo valid memory data. */
  saveManifest?(manifest: RefreshManifest): void;
  /** Reject-only history: never supplies routing bytes or authorizes Start. */
  readSafetyFloor?(): Promise<RefreshManifest | null>;
  commitSafetyFloor?(
    manifest: RefreshManifest,
    signal: AbortSignal,
  ): Promise<void>;
  now?(): number;
}
export interface FreshnessState {
  checking: boolean;
  offline: boolean;
  requiresCheck: boolean;
  activeRide: boolean;
  pendingSequence: number | null;
  acceptedSequence: number | null;
  successfulCheckAt: number | null;
  failedCheckAt: number | null;
  error: string | null;
  cacheError: string | null;
  consecutiveFailures: number;
  staleSources: string[];
}
/** Owns validated, separately prepared data; host reads accepted.value in one synchronous adoption step. */
export class RuntimeFreshness<T> {
  private current: PreparedData<T> | null;
  private safetyFloor: RefreshManifest | null = null;
  private staged: PreparedData<T> | null = null;
  private running: Promise<boolean> | null = null;
  private abort: AbortController | null = null;
  private disposed = false;
  private revision = 0;
  private listeners = new Set<() => void>();
  private state: Omit<
    FreshnessState,
    "staleSources" | "pendingSequence" | "acceptedSequence"
  > = {
    checking: false,
    offline: false,
    requiresCheck: true,
    activeRide: false,
    successfulCheckAt: null,
    failedCheckAt: null,
    error: null,
    cacheError: null,
    consecutiveFailures: 0,
  };
  constructor(
    private deps: RefreshDependencies<T>,
    initial: PreparedData<T> | null = null,
  ) {
    this.current = initial;
  }
  get accepted(): PreparedData<T> | null {
    return this.current;
  }
  get snapshot(): FreshnessState {
    return {
      ...this.state,
      pendingSequence: this.staged?.manifest.sequence ?? null,
      acceptedSequence: this.current?.manifest.sequence ?? null,
      staleSources: this.current
        ? staleSources(this.current.manifest, this.now())
        : [],
    };
  }
  private now() {
    return this.deps.now?.() ?? Date.now();
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  /** Tab messages/storage events are hints only. Never adopt a sender's objects or timestamps. */
  invalidate() {
    if (this.disposed) return;
    ++this.revision;
    this.state.requiresCheck = true;
    this.emit();
  }
  setOffline(offline: boolean) {
    if (this.disposed) return;
    this.state.offline = offline;
    if (offline) this.invalidate();
    else this.emit();
  }
  setActiveRide(active: boolean) {
    if (this.disposed || active === this.state.activeRide) return;
    this.state.activeRide = active;
    ++this.revision;
    if (!active) this.state.requiresCheck = true;
    this.emit();
  }
  /** Launch/resume/manual/tab/online/Start share one in-flight attempt. No timer, no automatic retry loop. */
  check(_trigger: RefreshTrigger): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.running) return this.running;
    const revision = this.revision;
    const abort = new AbortController();
    this.abort = abort;
    this.state.checking = true;
    this.emit();
    // Defer so repeated synchronous triggers see the same promise even with synchronous test dependencies.
    const task = Promise.resolve()
      .then(async () => {
        let candidate: PreparedData<T> | null = null;
        try {
          if (this.state.offline)
            throw new DatasetError(
              "data-unavailable",
              "You are offline. Accepted data is retained. Reconnect and check again before starting.",
            );
          const storedFloor = await this.deps.readSafetyFloor?.();
          if (storedFloor) {
            const floor = parseSafetyHistory(storedFloor);
            if (this.safetyFloor && floor.sequence < this.safetyFloor.sequence)
              assertSafeSuccessor(floor, this.safetyFloor);
            else {
              if (this.safetyFloor)
                assertSafeSuccessor(this.safetyFloor, floor);
              this.safetyFloor = floor;
            }
          }
          if (this.safetyFloor)
            assertManifestClock(this.safetyFloor, this.now());
          const manifest = parseRefreshManifest(
            await this.deps.readManifest(abort.signal),
            this.now(),
          );
          const baseline =
            this.safetyFloor ?? this.staged?.manifest ?? this.current?.manifest;
          if (baseline) assertSafeSuccessor(baseline, manifest);
          if (
            !this.current ||
            canonical(this.current.manifest) !== canonical(manifest)
          ) {
            candidate = await this.deps.prepare(manifest, abort.signal);
            if (canonical(candidate.manifest) !== canonical(manifest))
              throw new DatasetError(
                "data-corrupt",
                "The prepared routing data differs from the checked release.",
              );
          }
          if (this.disposed || abort.signal.aborted) return false;
          // Advance the in-memory rejection floor even if durable storage fails.
          this.safetyFloor = manifest;
          await this.deps.commitSafetyFloor?.(manifest, abort.signal);
          if (this.disposed || abort.signal.aborted) return false;
          // Invalidated checks cannot authorize Start. Valid bytes may still be staged/adopted safely.
          this.state.requiresCheck = revision !== this.revision;
          this.state.successfulCheckAt = this.now();
          this.state.error = this.state.requiresCheck
            ? "The page or another tab changed during this check. Check again before Start; accepted data is retained."
            : null;
          this.state.consecutiveFailures = 0;
          if (candidate) {
            if (this.state.activeRide) {
              this.staged?.dispose();
              this.staged = candidate;
              candidate = null;
            } else {
              const old = this.current;
              this.current = candidate;
              candidate = null;
              this.staged?.dispose();
              this.staged = null;
              ++this.revision;
              old?.dispose();
            }
          }
          if (this.current && !this.state.activeRide) this.persist();
          return !this.state.requiresCheck;
        } catch (error) {
          if (!this.disposed && !abort.signal.aborted) {
            this.state.requiresCheck = true;
            this.state.error =
              error instanceof Error
                ? error.message
                : "The data check failed. Retry; accepted data is retained.";
            this.state.failedCheckAt = this.now();
            ++this.state.consecutiveFailures;
          }
          return false;
        } finally {
          candidate?.dispose();
        }
      })
      .finally(() => {
        this.running = null;
        this.abort = null;
        this.state.checking = false;
        if (!this.disposed) this.emit();
      });
    this.running = task;
    return task;
  }
  private persist() {
    try {
      this.deps.saveManifest?.(this.current!.manifest);
      this.state.cacheError = null;
    } catch {
      this.state.cacheError =
        "Accepted data is available in this tab, but could not be saved. Keep this page open and retry the check.";
    }
  }
  /** Inspect every restored/saved route using the latest accepted router before the host starts foreground navigation. */
  async start<R>(
    route: R,
    inspect: (data: T, route: R) => Promise<{ canNavigate: boolean }>,
    begin: (data: T, route: R) => void,
  ): Promise<boolean> {
    if (this.state.activeRide || this.disposed) return false;
    if (!(await this.check("start"))) return false;
    const data = this.current;
    if (
      !data ||
      this.state.offline ||
      staleSources(data.manifest, this.now()).length
    ) {
      this.state.error =
        "Source evidence is stale or unavailable. Check again; recalculate and review the route before Start.";
      this.emit();
      return false;
    }
    const revision = this.revision;
    try {
      const result = await inspect(data.value, route);
      if (
        this.disposed ||
        revision !== this.revision ||
        this.current !== data ||
        this.state.activeRide ||
        this.state.requiresCheck ||
        this.state.offline ||
        staleSources(data.manifest, this.now()).length
      )
        return false;
      if (!result.canNavigate) {
        this.state.error =
          "The route needs recalculation or has a closure/access warning. Review it before Start.";
        this.emit();
        return false;
      }
      // Synchronous begin and flag make parallel Start clicks unable to start two rides.
      begin(data.value, route);
      this.setActiveRide(true);
      return true;
    } catch (error) {
      this.state.error =
        error instanceof Error
          ? error.message
          : "Route revalidation failed. Recalculate before Start.";
      this.emit();
      return false;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort?.abort();
    this.current?.dispose();
    this.staged?.dispose();
    this.current = null;
    this.staged = null;
    this.listeners.clear();
  }
}
