// The saved-library coordinator: a provider-independent, asynchronous engine that keeps ONE signed-in account's saved
// routes and places in step with the cloud, truthfully. It is deliberately not wired into the app (no UI, no sign-in, no
// Firebase): it talks only to the three boundaries in ./types.ts. docs/web/saved-library-sync.md is the specification;
// the numbered rules in the comments below are the ones its tests pin down.
//
// The model, in one paragraph. The cloud's copy of a record is "acknowledged" and carries a revision. A rider's unsent
// change is a journal ENTRY (at most one per record: what the rider wants + the revision it was based on) and is
// persisted before it is sent. Every send is conditional on that revision, so a stale writer fails instead of
// overwriting. Anything the engine cannot prove is surfaced as a conflict for the rider; it never merges and never lets
// the last writer win. Hard deletes leave no tombstone in the cloud, so the engine never replays a create whose outcome
// it cannot account for and never believes a deletion it has not verified with an authoritative read.
import { ID_PATTERN, LIMITS } from "../contract";
import { AccountEpochs, acceptDelivery } from "../ownership";
import type { ObservationToken } from "../ownership";
import {
  checkContent,
  collectionOfRecord,
  compareInstants,
  contentOf,
  keyOfRecord,
  readRecord,
  recordKey,
  sameContent,
  sameInstant,
} from "./content";
import { parseCache, parseJournal } from "./journal";
import type {
  AccountSession,
  Attempt,
  CloudRecord,
  Collection,
  ConflictCode,
  ItemState,
  LibraryItem,
  LibrarySnapshot,
  LibraryStorage,
  LibraryTransport,
  MutationResult,
  PendingEntry,
  Phase,
  RecordKey,
  SnapshotInput,
  Tombstone,
  UnsentSummary,
  WriteRequest,
  WriteResult,
} from "./types";

const COLLECTIONS: readonly Collection[] = ["routes", "places"];
const MAX_TOMBSTONES = 1000;

export interface CoordinatorOptions {
  session: AccountSession;
  transport: LibraryTransport;
  storage: LibraryStorage;
  now?: () => number;
  /** A fresh unguessable id for attempts. Defaults to crypto.randomUUID. */
  randomId?: () => string;
  /** Runs `run` after `delayMs` and returns a cancel function. Defaults to setTimeout. */
  schedule?: (run: () => void, delayMs: number) => () => void;
  retryDelayMs?: (failures: number) => number;
  maxConcurrentWrites?: number;
  /** Keep the acknowledged-record cache on disk after sign-out. Default false: sign-out clears it (unsent work stays). */
  keepCacheOnSignOut?: boolean;
}

interface LibraryState {
  readonly uid: string;
  readonly token: ObservationToken;
  disposed: boolean;
  phase: Phase;
  unavailableReason?: "storage-unavailable" | "journal-unsupported";
  confirmed: Map<string, CloudRecord>;
  tombstones: Map<string, Tombstone>;
  entries: Map<string, PendingEntry>;
  unreadable: Map<string, string>;
  /** Keys with a send or probe in progress (in memory only: after a reload nothing is in flight). */
  inflight: Set<string>;
  probing: Set<string>;
  retryAt: Map<string, number>;
  listeners: Map<Collection, () => void>;
  listenRetryAt: number | null;
  listenFailures: number;
  wake: (() => void) | null;
  clock: number;
  lastSnapshot: Record<Collection, number>;
  connection: "unknown" | "online" | "offline";
  durable: boolean;
  recovered: { entries: number; records: number };
  cacheQueued: Promise<void> | null;
  ready: Promise<void>;
  markReady: () => void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function newRecordId(
  random: (length: number) => Uint8Array = (length) =>
    globalThis.crypto.getRandomValues(new Uint8Array(length)),
): string {
  let binary = "";
  for (const byte of random(16)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export class SavedLibraryCoordinator {
  private readonly session: AccountSession;
  private readonly transport: LibraryTransport;
  private readonly storage: LibraryStorage;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly schedule: (run: () => void, delayMs: number) => () => void;
  private readonly retryDelayMs: (failures: number) => number;
  private readonly maxConcurrent: number;
  private readonly keepCache: boolean;
  private readonly epochs = new AccountEpochs();
  private state: LibraryState | null = null;
  private stopSession: (() => void) | null = null;
  private readonly subscribers = new Set<() => void>();
  private version = 0;
  private cached: { version: number; snapshot: LibrarySnapshot } | null = null;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly busy = new Set<Promise<unknown>>();
  private counters = {
    staleCallbacksDropped: 0,
    foreignRecordsDropped: 0,
    staleRecordsIgnored: 0,
    faults: 0,
  };

  constructor(options: CoordinatorOptions) {
    this.session = options.session;
    this.transport = options.transport;
    this.storage = options.storage;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => globalThis.crypto.randomUUID());
    this.schedule =
      options.schedule ??
      ((run, delayMs) => {
        const timer = setTimeout(run, delayMs);
        return () => clearTimeout(timer);
      });
    this.retryDelayMs =
      options.retryDelayMs ??
      ((failures) => Math.min(60_000, 1000 * 2 ** Math.max(0, failures - 1)));
    this.maxConcurrent = options.maxConcurrentWrites ?? 3;
    this.keepCache = options.keepCacheOnSignOut ?? false;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // lifecycle

  /** Begins following the session. Safe to call once; the current account (if any) is loaded immediately. */
  start(): void {
    if (this.stopSession) return;
    this.stopSession = this.session.subscribe(() => this.reconcile());
    this.reconcile();
  }

  /** Stops following the session and releases listeners and timers. Local data is kept for the next start. */
  async stop(): Promise<void> {
    this.stopSession?.();
    this.stopSession = null;
    const state = this.state;
    this.state = null;
    if (state) this.dispose(state, false);
    this.epochs.switchTo(null);
    this.emit();
    await this.whenIdle();
  }

  /** Resolves when no load, send, probe or local save is in progress (timers waiting to retry do not count). */
  async whenIdle(): Promise<void> {
    while (this.busy.size) await Promise.allSettled([...this.busy]);
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Counters that make stale-callback and foreign-record rejection observable (tests, support logs). */
  diagnostics() {
    return { ...this.counters };
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.busy.add(promise);
    const done = () => this.busy.delete(promise);
    promise.then(done, done);
    return promise;
  }

  private emit() {
    this.version++;
    this.cached = null;
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber();
      } catch {
        /* a subscriber's failure never stops the engine */
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // account changes (rules 1 and 2: epoch-scoped everything, immediate rejection of stale callbacks)

  /** Brings the engine in line with the session RIGHT NOW. Called on every notification and whenever a check fails. */
  private reconcile() {
    const uid = this.session.current();
    const old = this.state;
    if (old ? old.uid === uid : uid === null) return;
    this.state = null;
    if (old) this.dispose(old, !this.keepCache);
    const token = this.epochs.switchTo(uid);
    if (uid !== null) {
      let markReady!: () => void;
      const ready = new Promise<void>((resolve) => (markReady = resolve));
      const state: LibraryState = {
        uid,
        token,
        disposed: false,
        phase: "loading",
        confirmed: new Map(),
        tombstones: new Map(),
        entries: new Map(),
        unreadable: new Map(),
        inflight: new Set(),
        probing: new Set(),
        retryAt: new Map(),
        listeners: new Map(),
        listenRetryAt: null,
        listenFailures: 0,
        wake: null,
        clock: 0,
        lastSnapshot: { routes: 0, places: 0 },
        connection: "unknown",
        durable: true,
        recovered: { entries: 0, records: 0 },
        cacheQueued: null,
        ready,
        markReady,
      };
      this.state = state;
      this.track(this.begin(state));
    }
    this.emit();
  }

  private dispose(state: LibraryState, clearCache: boolean) {
    state.disposed = true;
    for (const stop of state.listeners.values()) {
      try {
        stop();
      } catch {
        /* already gone */
      }
    }
    state.listeners.clear();
    state.wake?.();
    state.wake = null;
    state.markReady();
    if (clearCache)
      this.track(
        this.enqueue(state.uid, () =>
          this.storage.removeCache(state.uid),
        ).catch(() => undefined),
      );
  }

  /** True while `state` is still the current account's. A false answer is counted: it is a stale callback. */
  private live(state: LibraryState): boolean {
    if (!state.disposed && this.session.current() !== state.uid)
      this.reconcile();
    if (state.disposed || !this.epochs.isCurrent(state.token)) {
      this.counters.staleCallbacksDropped++;
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // persistence (everything per uid, strictly ordered per uid)

  private enqueue<T>(uid: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(uid) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.queues.set(
      uid,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  /** Writes the whole journal. Resolves true when it is durable. Called BEFORE a request is sent (write-ahead). */
  private persistJournal(state: LibraryState): Promise<boolean> {
    return this.track(
      this.enqueue(state.uid, async () => {
        try {
          await this.storage.saveJournal(state.uid, {
            version: 1,
            uid: state.uid,
            entries: [...state.entries.values()],
          });
          if (!state.durable) {
            state.durable = true;
            this.emit();
          }
          return true;
        } catch {
          if (state.durable) {
            state.durable = false;
            this.emit();
          }
          return false;
        }
      }),
    );
  }

  /** The cache is only a convenience, so saves are coalesced and a failure is not reported as lost work. */
  private persistCache(state: LibraryState) {
    if (state.disposed || state.cacheQueued) return;
    const queued = this.enqueue(state.uid, async () => {
      state.cacheQueued = null;
      if (state.disposed) return;
      try {
        await this.storage.saveCache(state.uid, {
          version: 1,
          uid: state.uid,
          records: [...state.confirmed.values()],
          tombstones: [...state.tombstones.values()],
        });
      } catch {
        /* the cloud still has it */
      }
    });
    state.cacheQueued = queued;
    this.track(queued);
  }

  private async begin(state: LibraryState) {
    let journalRaw: unknown;
    let cacheRaw: unknown;
    try {
      [journalRaw, cacheRaw] = await this.enqueue(state.uid, async () => [
        await this.storage.loadJournal(state.uid),
        await this.storage.loadCache(state.uid),
      ]);
    } catch {
      if (state.disposed) return;
      state.phase = "unavailable";
      state.unavailableReason = "storage-unavailable";
      state.markReady();
      this.emit();
      return;
    }
    if (state.disposed) return;
    const journal = parseJournal(state.uid, journalRaw);
    if (!journal.ok) {
      state.phase = "unavailable";
      state.unavailableReason = journal.reason;
      state.markReady();
      this.emit();
      return;
    }
    const cache = parseCache(state.uid, cacheRaw);
    for (const record of cache.records)
      state.confirmed.set(
        recordKey(collectionOfRecord(record), record.id),
        record,
      );
    for (const tombstone of cache.tombstones)
      state.tombstones.set(
        recordKey(tombstone.collection, tombstone.id),
        tombstone,
      );
    for (const entry of journal.entries) {
      // Nothing is in flight after a load: a "retrying" entry is simply queued again. An attempt whose outcome was never
      // seen keeps mayHaveApplied, which is what makes the next send check the cloud first (rule 7).
      if (entry.status === "retrying") entry.status = "queued";
      state.entries.set(recordKey(entry.collection, entry.id), entry);
    }
    state.recovered = { entries: journal.dropped, records: cache.dropped };
    state.phase = "ready";
    state.markReady();
    this.emit();
    this.attachListeners(state);
    this.pump(state);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // reads: listeners and refresh (rule 3: nothing is shown for an account that is no longer current)

  private attachListeners(state: LibraryState) {
    if (state.disposed || state.phase !== "ready") return;
    for (const collection of COLLECTIONS) {
      if (state.listeners.has(collection)) continue;
      try {
        const stop = this.transport.listen(state.uid, collection, {
          onSnapshot: (snapshot) => {
            if (!this.live(state)) return;
            state.lastSnapshot[collection] = ++state.clock;
            state.listenFailures = 0;
            this.applyView(state, collection, snapshot);
          },
          onError: (error) => {
            if (!this.live(state)) return;
            state.listeners.get(collection)?.();
            state.listeners.delete(collection);
            this.seen(
              state,
              error.code === "unavailable" ? "offline" : "unknown",
            );
            this.listenFailed(state);
          },
        });
        state.listeners.set(collection, stop);
      } catch {
        this.listenFailed(state);
      }
    }
  }

  /** One outage counts once, however many listeners it takes down. */
  private listenFailed(state: LibraryState) {
    if (state.listenRetryAt === null)
      state.listenRetryAt =
        this.now() + this.retryDelayMs(++state.listenFailures);
    this.scheduleWake(state);
  }

  /** One bounded read of both collections, for a transport without listeners or a manual refresh. */
  async refresh(): Promise<void> {
    const state = this.state;
    if (!state || !this.live(state) || state.phase !== "ready") return;
    await this.track(
      Promise.all(
        COLLECTIONS.map(async (collection) => {
          const stamp = ++state.clock;
          let result;
          try {
            result = await this.transport.list(state.uid, {
              collection,
              limit: LIMITS.listLimitMax,
            });
          } catch {
            result = { kind: "unavailable" as const };
          }
          if (!this.live(state)) return;
          if (!isObject(result) || result.kind !== "ok") {
            this.seen(state, "offline");
            return;
          }
          // A listener delivery that arrived while this read was in flight is newer than it: drop the read.
          if (state.lastSnapshot[collection] > stamp) return;
          state.lastSnapshot[collection] = ++state.clock;
          this.applyView(state, collection, {
            readFor: result.readFor,
            complete: result.complete,
            records: result.records,
            removed: [],
          });
        }),
      ),
    );
  }

  private seen(state: LibraryState, connection: LibraryState["connection"]) {
    if (state.connection === connection) return;
    state.connection = connection;
    this.emit();
  }

  /** Applies a delivery from the cloud: validated, owner-checked, monotonic per record. Deletions are only verified. */
  private applyView(
    state: LibraryState,
    collection: Collection,
    input: SnapshotInput,
  ) {
    if (
      !isObject(input) ||
      !Array.isArray(input.records) ||
      typeof input.readFor !== "string"
    )
      return;
    state.connection = "online";
    const parsed: CloudRecord[] = [];
    const present = new Set<string>();
    for (const raw of input.records) {
      const read = readRecord(collection, raw, state.uid);
      const id = isObject(raw) && typeof raw.id === "string" ? raw.id : null;
      if (read.ok) {
        parsed.push(read.value);
        present.add(read.value.id);
      } else if (read.code === "owner-mismatch") {
        this.counters.foreignRecordsDropped++;
      } else if (id && ID_PATTERN.test(id)) {
        // A record this build cannot read is never shown, and its presence is not a deletion.
        present.add(id);
        state.unreadable.set(recordKey(collection, id), read.code);
        state.confirmed.delete(recordKey(collection, id));
      }
    }
    const accepted = acceptDelivery(this.epochs, {
      token: state.token,
      readFor: input.readFor,
      records: parsed,
    });
    if (accepted === null) {
      this.counters.staleCallbacksDropped++;
      return;
    }
    for (const record of accepted) this.merge(state, record);
    const gone: string[] = [];
    if (input.complete === true) {
      for (const [key, record] of state.confirmed)
        if (
          collectionOfRecord(record) === collection &&
          !present.has(record.id)
        )
          gone.push(key);
    }
    for (const id of Array.isArray(input.removed) ? input.removed : [])
      if (typeof id === "string" && ID_PATTERN.test(id))
        gone.push(recordKey(collection, id));
    for (const key of gone) this.verifyRemoval(state, key);
    this.emit();
    this.persistCache(state);
  }

  /**
   * Rule 5 (no resurrection by a stale read): a record is only accepted if it is newer than what is held and is not an
   * older copy of an incarnation known to be deleted. Returns whether it was applied.
   */
  private merge(state: LibraryState, record: CloudRecord): boolean {
    const key = recordKey(collectionOfRecord(record), record.id);
    const tombstone = state.tombstones.get(key);
    if (tombstone) {
      const sameIncarnation =
        tombstone.createdAt === null ||
        sameInstant(tombstone.createdAt, record.createdAt);
      if (sameIncarnation && record.revision <= tombstone.revision) {
        this.counters.staleRecordsIgnored++;
        return false;
      }
      state.tombstones.delete(key);
    }
    const current = state.confirmed.get(key);
    if (current) {
      const order = compareInstants(current.createdAt, record.createdAt);
      if (order === 0) {
        if (record.revision <= current.revision) {
          if (record.revision < current.revision)
            this.counters.staleRecordsIgnored++;
          return false;
        }
      } else if (order > 0) {
        // The held copy is a newer incarnation of this id than the one delivered: the delivery is stale.
        this.counters.staleRecordsIgnored++;
        return false;
      }
    }
    state.confirmed.set(key, record);
    state.unreadable.delete(key);
    this.reconcileEntry(state, key);
    return true;
  }

  private addTombstone(state: LibraryState, key: string, tombstone: Tombstone) {
    state.tombstones.delete(key);
    state.tombstones.set(key, tombstone);
    while (state.tombstones.size > MAX_TOMBSTONES) {
      const oldest = state.tombstones.keys().next().value;
      if (oldest === undefined) break;
      state.tombstones.delete(oldest);
    }
  }

  /** Rule 6: a deletion is believed only from an authoritative read (or this device's own acknowledged delete). */
  private verifyRemoval(state: LibraryState, key: string) {
    const held = state.confirmed.get(key);
    if (!held || state.probing.has(key)) return;
    const collection = collectionOfRecord(held);
    state.probing.add(key);
    this.track(
      (async () => {
        let result;
        try {
          result = await this.transport.read(state.uid, collection, held.id);
        } catch {
          result = { kind: "unavailable" as const };
        }
        state.probing.delete(key);
        if (!this.live(state)) return;
        if (!isObject(result)) return;
        if (result.kind === "found") {
          const read = readRecord(collection, result.record, state.uid);
          if (read.ok && read.value.id === held.id)
            this.merge(state, read.value);
          state.connection = "online";
        } else if (result.kind === "absent") {
          state.connection = "online";
          this.applyAbsence(state, key);
        } else {
          this.seen(state, "offline");
        }
        this.emit();
        this.persistCache(state);
      })(),
    );
  }

  private applyAbsence(state: LibraryState, key: string) {
    const held = state.confirmed.get(key);
    if (!held) return;
    state.confirmed.delete(key);
    this.addTombstone(state, key, {
      collection: collectionOfRecord(held),
      id: held.id,
      createdAt: held.createdAt,
      revision: held.revision,
    });
    this.reconcileEntry(state, key);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // reconciling an unsent change against what the cloud now shows (rules 8 and 9)

  /**
   * Compares an entry that is not being sent against the cloud's verified state. It never overwrites anything: it either
   * recognises that the cloud already holds the change (acknowledged), or records an explicit conflict.
   */
  private reconcileEntry(state: LibraryState, key: string) {
    const entry = state.entries.get(key);
    if (!entry || state.inflight.has(key) || entry.attempt?.mayHaveApplied)
      return;
    const remote = state.confirmed.get(key) ?? null;
    if (!remote && !state.tombstones.has(key)) return;
    const base = entry.baseRevision;
    if (entry.status === "rejected") {
      // A refused change that the cloud now satisfies by itself is simply done; anything else stays for the rider.
      if (entry.want.kind === "delete" && !remote && base !== null)
        this.acknowledge(state, entry);
      else if (
        entry.want.kind === "put" &&
        remote &&
        remote.revision > (base ?? 0) &&
        sameContent(contentOf(remote), entry.want.content)
      )
        this.acknowledge(state, entry);
      return;
    }
    if (entry.want.kind === "put") {
      if (base === null) {
        if (!remote) return;
        if (
          remote.revision === 1 &&
          sameContent(contentOf(remote), entry.want.content)
        )
          this.acknowledge(state, entry);
        else this.conflict(state, entry, "already-exists", remote);
      } else if (!remote) {
        this.conflict(state, entry, "deleted-elsewhere", null);
      } else if (remote.revision > base) {
        if (sameContent(contentOf(remote), entry.want.content))
          this.acknowledge(state, entry);
        else this.conflict(state, entry, "edited-elsewhere", remote);
      } else if (entry.status === "conflict" && entry.conflict) {
        entry.conflict = { ...entry.conflict, remote };
      }
    } else if (base !== null) {
      if (!remote) this.acknowledge(state, entry);
      else if (remote.revision > base)
        this.conflict(state, entry, "edited-elsewhere", remote);
    }
  }

  private acknowledge(state: LibraryState, entry: PendingEntry) {
    state.entries.delete(recordKey(entry.collection, entry.id));
    state.retryAt.delete(recordKey(entry.collection, entry.id));
    this.emit();
    void this.persistJournal(state);
  }

  private conflict(
    state: LibraryState,
    entry: PendingEntry,
    code: ConflictCode,
    remote: CloudRecord | null,
  ) {
    entry.status = "conflict";
    entry.conflict = { code, remote };
    entry.attempt = null;
    entry.rejectedCode = undefined;
    state.retryAt.delete(recordKey(entry.collection, entry.id));
    this.emit();
    void this.persistJournal(state);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // sending

  private pump(state: LibraryState) {
    if (state.disposed || state.phase !== "ready") return;
    const now = this.now();
    const due = [...state.entries.entries()]
      .filter(
        ([key, entry]) =>
          (entry.status === "queued" || entry.status === "retrying") &&
          !state.inflight.has(key) &&
          (state.retryAt.get(key) ?? 0) <= now,
      )
      .sort((a, b) => a[1].queuedAt - b[1].queuedAt);
    for (const [key, entry] of due) {
      if (state.inflight.size >= this.maxConcurrent) break;
      state.inflight.add(key);
      this.track(
        this.sendEntry(state, entry)
          .catch(() => {
            this.counters.faults++;
            if (state.entries.get(key) === entry) {
              entry.status = "retrying";
              entry.failures++;
              state.retryAt.set(
                key,
                this.now() + this.retryDelayMs(entry.failures),
              );
            }
          })
          .finally(() => {
            state.inflight.delete(key);
            if (state.disposed) return;
            this.reconcileEntry(state, key);
            this.emit();
            this.pump(state);
          }),
      );
    }
    this.scheduleWake(state);
  }

  private scheduleWake(state: LibraryState) {
    if (state.disposed) return;
    let at: number | null = state.listenRetryAt;
    for (const [key, entry] of state.entries) {
      if (entry.status !== "retrying" && entry.status !== "queued") continue;
      const when = state.retryAt.get(key);
      if (when !== undefined && (at === null || when < at)) at = when;
    }
    state.wake?.();
    state.wake = null;
    if (at === null) return;
    state.wake = this.schedule(
      () => {
        state.wake = null;
        if (state.disposed || !this.live(state)) return;
        if (state.listenRetryAt !== null && state.listenRetryAt <= this.now())
          state.listenRetryAt = null;
        this.attachListeners(state);
        this.pump(state);
      },
      Math.max(0, at - this.now()),
    );
  }

  /** Retry everything that is waiting right now (for example when the browser reports it is back online). */
  retryNow(): void {
    const state = this.state;
    if (!state || !this.live(state)) return;
    state.retryAt.clear();
    state.listenRetryAt = null;
    this.attachListeners(state);
    this.pump(state);
  }

  private async sendEntry(state: LibraryState, entry: PendingEntry) {
    const key = recordKey(entry.collection, entry.id);
    const { uid } = state;
    const want = entry.want;
    const base = entry.baseRevision;
    let request: WriteRequest;
    if (base === null) {
      // Rule 7: a create whose outcome is unknown is never simply repeated. Ask the cloud first.
      if (entry.attempt?.mayHaveApplied) return this.probeCreate(state, entry);
      if (want.kind === "delete") {
        // Nothing the cloud could hold: the rider removed a record this device never managed to send.
        this.acknowledge(state, entry);
        return;
      }
      request = {
        kind: "create",
        collection: entry.collection,
        id: entry.id,
        content: want.content,
      };
    } else if (want.kind === "put") {
      request = {
        kind: "update",
        collection: entry.collection,
        id: entry.id,
        content: want.content,
        expectedRevision: base,
      };
    } else {
      request = {
        kind: "delete",
        collection: entry.collection,
        id: entry.id,
        expectedRevision: base,
      };
    }
    const previous = entry.attempt;
    const attempt: Attempt = {
      attemptId: this.randomId(),
      kind: request.kind,
      baseRevision: base,
      content: request.kind === "delete" ? null : request.content,
      mayHaveApplied: true,
      earlier:
        previous?.mayHaveApplied && previous.baseRevision === base
          ? [
              ...previous.earlier,
              ...(previous.content ? [previous.content] : []),
            ]
          : [],
    };
    entry.attempt = attempt;
    entry.status = "queued";
    this.emit();
    // Write-ahead: the attempt is on disk (as "may have applied") before any byte is sent.
    await this.persistJournal(state);
    if (!this.live(state) || state.entries.get(key) !== entry) return;
    let result: WriteResult;
    try {
      result = await this.transport.write(uid, request);
    } catch {
      result = { kind: "unknown" };
    }
    // Rules 2 and 4: a completion for an account that is no longer current is dropped (the journal still records the
    // attempt as possibly applied, and the next sign-in checks the cloud first), and so is a duplicate or late one.
    if (!this.live(state)) return;
    if (
      state.entries.get(key) !== entry ||
      entry.attempt?.attemptId !== attempt.attemptId
    )
      return;
    await this.settle(state, entry, attempt, result);
  }

  private async settle(
    state: LibraryState,
    entry: PendingEntry,
    attempt: Attempt,
    raw: WriteResult,
  ) {
    const key = recordKey(entry.collection, entry.id);
    const result: WriteResult =
      isObject(raw) && typeof raw.kind === "string" ? raw : { kind: "unknown" };
    switch (result.kind) {
      case "committed": {
        const read =
          attempt.kind === "delete"
            ? null
            : readRecord(entry.collection, result.record, state.uid);
        const expected =
          attempt.baseRevision === null ? 1 : attempt.baseRevision + 1;
        if (
          !read ||
          !read.ok ||
          read.value.id !== entry.id ||
          read.value.revision !== expected
        )
          return this.transient(state, entry, "unknown");
        state.connection = "online";
        return this.absorbCommit(state, entry, read.value);
      }
      case "deleted": {
        if (attempt.kind !== "delete")
          return this.transient(state, entry, "unknown");
        state.connection = "online";
        return this.absorbDelete(state, entry, attempt.baseRevision ?? 0);
      }
      case "precondition-failed": {
        state.connection = "online";
        return this.afterRefusal(state, entry, attempt);
      }
      case "rejected": {
        state.connection = "online";
        entry.attempt = null;
        entry.status = "rejected";
        entry.rejectedCode =
          typeof result.code === "string"
            ? result.code.slice(0, 64)
            : "rejected";
        entry.failures = 0;
        state.retryAt.delete(key);
        this.emit();
        void this.persistJournal(state);
        return;
      }
      case "unavailable":
        return this.transient(state, entry, "unavailable");
      default:
        return this.transient(state, entry, "unknown");
    }
  }

  /** A send that failed for a reason that may pass. `unavailable` proves nothing was applied; `unknown` does not. */
  private transient(
    state: LibraryState,
    entry: PendingEntry,
    kind: "unavailable" | "unknown",
  ) {
    const key = recordKey(entry.collection, entry.id);
    if (kind === "unavailable") {
      entry.attempt = null;
      state.connection = "offline";
    }
    entry.status = "retrying";
    entry.failures++;
    state.retryAt.set(key, this.now() + this.retryDelayMs(entry.failures));
    this.emit();
    void this.persistJournal(state);
  }

  private absorbCommit(
    state: LibraryState,
    entry: PendingEntry,
    record: CloudRecord,
  ) {
    const key = recordKey(entry.collection, entry.id);
    this.merge(state, record);
    entry.attempt = null;
    entry.failures = 0;
    entry.status = "queued";
    entry.baseRevision = record.revision;
    state.retryAt.delete(key);
    if (
      entry.want.kind === "put" &&
      sameContent(contentOf(record), entry.want.content)
    )
      state.entries.delete(key);
    this.emit();
    void this.persistJournal(state);
    this.persistCache(state);
  }

  private absorbDelete(
    state: LibraryState,
    entry: PendingEntry,
    revision: number,
  ) {
    const key = recordKey(entry.collection, entry.id);
    const held = state.confirmed.get(key);
    state.confirmed.delete(key);
    this.addTombstone(state, key, {
      collection: entry.collection,
      id: entry.id,
      createdAt: held?.createdAt ?? null,
      revision: Math.max(held?.revision ?? 0, revision),
    });
    state.entries.delete(key);
    state.retryAt.delete(key);
    this.emit();
    void this.persistJournal(state);
    this.persistCache(state);
  }

  /** Whether `record` is exactly something this entry's own earlier requests could have written. */
  private isMine(record: CloudRecord, attempt: Attempt): boolean {
    const mine = [
      ...attempt.earlier,
      ...(attempt.content ? [attempt.content] : []),
    ];
    return mine.some((content) => sameContent(contentOf(record), content));
  }

  /** A conditional request was refused: read the cloud and classify (rules 7 to 9). */
  private async afterRefusal(
    state: LibraryState,
    entry: PendingEntry,
    attempt: Attempt,
  ) {
    const key = recordKey(entry.collection, entry.id);
    const probe = await this.probe(state, entry);
    if (
      !probe ||
      state.entries.get(key) !== entry ||
      entry.attempt?.attemptId !== attempt.attemptId
    )
      return;
    if (probe.kind === "unavailable")
      return this.transient(state, entry, "unknown");
    if (probe.kind === "found") {
      const remote = probe.record;
      if (attempt.kind === "create") {
        if (remote.revision === 1 && this.isMine(remote, attempt))
          return this.absorbCommit(state, entry, remote);
        this.merge(state, remote);
        return this.conflict(state, entry, "already-exists", remote);
      }
      const base = attempt.baseRevision ?? 0;
      if (
        attempt.kind === "update" &&
        remote.revision === base + 1 &&
        this.isMine(remote, attempt)
      )
        return this.absorbCommit(state, entry, remote);
      this.merge(state, remote);
      if (remote.revision === base)
        return this.rejectInconsistent(state, entry);
      return this.conflict(state, entry, "edited-elsewhere", remote);
    }
    // The record is not there.
    if (attempt.kind === "delete")
      return this.absorbDelete(state, entry, attempt.baseRevision ?? 0);
    const held = state.confirmed.get(key);
    this.addTombstone(state, key, {
      collection: entry.collection,
      id: entry.id,
      createdAt: held?.createdAt ?? null,
      revision: Math.max(held?.revision ?? 0, attempt.baseRevision ?? 0),
    });
    state.confirmed.delete(key);
    return this.conflict(
      state,
      entry,
      attempt.kind === "create" ? "possibly-deleted" : "deleted-elsewhere",
      null,
    );
  }

  /** The cloud refused a request whose precondition its own record satisfies: refuse to loop on it. */
  private rejectInconsistent(state: LibraryState, entry: PendingEntry) {
    entry.attempt = null;
    entry.status = "rejected";
    entry.rejectedCode = "precondition-inconsistent";
    state.retryAt.delete(recordKey(entry.collection, entry.id));
    this.emit();
    void this.persistJournal(state);
  }

  /** An authoritative read for this entry's record, validated; null if the account changed while it was in flight. */
  private async probe(
    state: LibraryState,
    entry: PendingEntry,
  ): Promise<
    | { kind: "found"; record: CloudRecord }
    | { kind: "absent" }
    | { kind: "unavailable" }
    | null
  > {
    let result;
    try {
      result = await this.transport.read(state.uid, entry.collection, entry.id);
    } catch {
      result = { kind: "unavailable" as const };
    }
    if (!this.live(state)) return null;
    if (!isObject(result)) return { kind: "unavailable" };
    if (result.kind === "found") {
      const read = readRecord(entry.collection, result.record, state.uid);
      if (!read.ok || read.value.id !== entry.id) {
        this.unreadableRemote(
          state,
          entry,
          read.ok ? "id-mismatch" : read.code,
        );
        return null;
      }
      state.connection = "online";
      return { kind: "found", record: read.value };
    }
    if (result.kind === "absent") {
      state.connection = "online";
      return { kind: "absent" };
    }
    this.seen(state, "offline");
    return { kind: "unavailable" };
  }

  private unreadableRemote(
    state: LibraryState,
    entry: PendingEntry,
    code: string,
  ) {
    const key = recordKey(entry.collection, entry.id);
    state.unreadable.set(key, code);
    entry.attempt = null;
    entry.status = "rejected";
    entry.rejectedCode = `unreadable-remote:${code}`;
    this.emit();
    void this.persistJournal(state);
  }

  /** Rule 7: the create's outcome is unknown. Found as sent: acknowledged. Absent: possibly deleted elsewhere. */
  private async probeCreate(state: LibraryState, entry: PendingEntry) {
    const key = recordKey(entry.collection, entry.id);
    const attempt = entry.attempt;
    if (!attempt) return;
    const probe = await this.probe(state, entry);
    if (!probe || state.entries.get(key) !== entry) return;
    if (probe.kind === "unavailable")
      return this.transient(state, entry, "unknown");
    if (probe.kind === "found") {
      if (probe.record.revision === 1 && this.isMine(probe.record, attempt))
        return this.absorbCommit(state, entry, probe.record);
      this.merge(state, probe.record);
      return this.conflict(
        state,
        entry,
        entry.want.kind === "put" ? "already-exists" : "edited-elsewhere",
        probe.record,
      );
    }
    if (entry.want.kind === "delete") return this.acknowledge(state, entry);
    return this.conflict(state, entry, "possibly-deleted", null);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // what riders do

  private async usable(): Promise<
    | { ok: true; state: LibraryState }
    | { ok: false; code: "signed-out" | "unavailable" }
  > {
    let state = this.state;
    if (state && !this.live(state)) state = this.state;
    if (!state) return { ok: false, code: "signed-out" };
    await state.ready;
    if (state.phase !== "ready") return { ok: false, code: "unavailable" };
    return { ok: true, state };
  }

  private async finish(
    state: LibraryState,
    key: string,
  ): Promise<MutationResult> {
    this.emit();
    this.pump(state);
    const durable = await this.persistJournal(state);
    return { ok: true, key, durable };
  }

  /** Saves a new record. The id must be new: ids are never reused, so a deleted id cannot come back. */
  async create(raw: unknown): Promise<MutationResult> {
    const gate = await this.usable();
    if (!gate.ok) return gate;
    const state = gate.state;
    const checked = await checkContent(raw, state.uid);
    if (!this.live(state)) return { ok: false, code: "account-changed" };
    if (!checked.ok)
      return {
        ok: false,
        code: checked.code === "owner-mismatch" ? "owner-mismatch" : "invalid",
        detail: checked.code,
      };
    const { collection, content } = checked.value;
    const key = recordKey(collection, content.id);
    const entry = state.entries.get(key);
    if (state.tombstones.has(key)) return { ok: false, code: "deleted" };
    if (entry) {
      if (entry.want.kind === "delete") return { ok: false, code: "deleted" };
      if (
        entry.baseRevision === null &&
        sameContent(entry.want.content, content)
      )
        return { ok: true, key, durable: state.durable };
      return { ok: false, code: "exists" };
    }
    if (state.confirmed.has(key) || state.unreadable.has(key))
      return { ok: false, code: "exists" };
    state.entries.set(
      key,
      this.newEntry(
        state,
        collection,
        content.id,
        { kind: "put", content },
        null,
      ),
    );
    return this.finish(state, key);
  }

  /** Changes a saved record (rename, replacement route, place edit). Same id, based on the revision last seen. */
  async update(raw: unknown): Promise<MutationResult> {
    const gate = await this.usable();
    if (!gate.ok) return gate;
    const state = gate.state;
    const checked = await checkContent(raw, state.uid);
    if (!this.live(state)) return { ok: false, code: "account-changed" };
    if (!checked.ok)
      return {
        ok: false,
        code: checked.code === "owner-mismatch" ? "owner-mismatch" : "invalid",
        detail: checked.code,
      };
    const { collection, content } = checked.value;
    const key = recordKey(collection, content.id);
    if (state.tombstones.has(key)) return { ok: false, code: "deleted" };
    const entry = state.entries.get(key);
    const held = state.confirmed.get(key);
    if (entry) {
      if (entry.want.kind === "delete") return { ok: false, code: "deleted" };
      if (entry.status === "conflict")
        return { ok: false, code: "in-conflict" };
      entry.want = { kind: "put", content };
      if (entry.status === "rejected") {
        entry.status = "queued";
        entry.rejectedCode = undefined;
        entry.failures = 0;
      }
      if (
        !entry.attempt &&
        entry.baseRevision !== null &&
        held &&
        held.revision === entry.baseRevision &&
        sameContent(contentOf(held), content)
      )
        state.entries.delete(key);
    } else {
      if (!held) return { ok: false, code: "not-found" };
      if (sameContent(contentOf(held), content))
        return { ok: true, key, durable: state.durable };
      state.entries.set(
        key,
        this.newEntry(
          state,
          collection,
          content.id,
          { kind: "put", content },
          held.revision,
        ),
      );
    }
    return this.finish(state, key);
  }

  /** Deletes a saved record. A record this device never managed to send simply disappears; no request is made for it. */
  async remove(target: RecordKey): Promise<MutationResult> {
    const gate = await this.usable();
    if (!gate.ok) return gate;
    const state = gate.state;
    if (
      !isObject(target) ||
      !COLLECTIONS.includes(target.collection) ||
      typeof target.id !== "string" ||
      !ID_PATTERN.test(target.id)
    )
      return { ok: false, code: "invalid" };
    const key = keyOfRecord(target);
    const entry = state.entries.get(key);
    const held = state.confirmed.get(key);
    if (entry) {
      if (entry.status === "conflict")
        return { ok: false, code: "in-conflict" };
      if (entry.want.kind === "delete")
        return { ok: true, key, durable: state.durable };
      if (entry.baseRevision === null && !entry.attempt?.mayHaveApplied)
        state.entries.delete(key);
      else {
        entry.want = {
          kind: "delete",
          last:
            entry.want.kind === "put"
              ? entry.want.content
              : (held && contentOf(held)) || undefined,
        };
        if (entry.status === "rejected") {
          entry.status = "queued";
          entry.rejectedCode = undefined;
          entry.failures = 0;
        }
      }
    } else {
      if (!held) return { ok: false, code: "not-found" };
      state.entries.set(
        key,
        this.newEntry(
          state,
          target.collection,
          target.id,
          { kind: "delete", last: contentOf(held) },
          held.revision,
        ),
      );
    }
    return this.finish(state, key);
  }

  /**
   * The rider's explicit decision on a conflict (rule 9). "keep-mine" re-bases the change on the cloud's current state
   * and sends it (for an edit of a record that is gone, this is the one way to save it again); "keep-theirs" drops the
   * unsent change and leaves the cloud's state as it is.
   */
  async resolveConflict(
    target: RecordKey,
    choice: "keep-mine" | "keep-theirs",
  ): Promise<MutationResult> {
    const gate = await this.usable();
    if (!gate.ok) return gate;
    const state = gate.state;
    const key = isObject(target) ? keyOfRecord(target) : "";
    const entry = state.entries.get(key);
    if (!entry || entry.status !== "conflict")
      return { ok: false, code: "not-found" };
    if (choice === "keep-theirs") {
      state.entries.delete(key);
      state.retryAt.delete(key);
      return this.finish(state, key);
    }
    const remote = state.confirmed.get(key) ?? null;
    entry.conflict = undefined;
    entry.attempt = null;
    entry.status = "queued";
    entry.failures = 0;
    if (entry.want.kind === "put") {
      if (remote) entry.baseRevision = remote.revision;
      else {
        // Explicitly saving again a record the cloud no longer has: the rider's decision, never an automatic one.
        entry.baseRevision = null;
        state.tombstones.delete(key);
      }
    } else if (remote) entry.baseRevision = remote.revision;
    else state.entries.delete(key);
    return this.finish(state, key);
  }

  /** Abandons an unsent change that is waiting, rejected or conflicted. Cannot cancel a request already in flight. */
  async discard(target: RecordKey): Promise<MutationResult> {
    const gate = await this.usable();
    if (!gate.ok) return gate;
    const state = gate.state;
    const key = isObject(target) ? keyOfRecord(target) : "";
    const entry = state.entries.get(key);
    if (!entry) return { ok: false, code: "not-found" };
    if (state.inflight.has(key))
      return { ok: false, code: "unavailable", detail: "busy" };
    state.entries.delete(key);
    state.retryAt.delete(key);
    return this.finish(state, key);
  }

  /** Puts a rejected or waiting change back in the queue immediately. */
  async retry(target: RecordKey): Promise<MutationResult> {
    const gate = await this.usable();
    if (!gate.ok) return gate;
    const state = gate.state;
    const key = isObject(target) ? keyOfRecord(target) : "";
    const entry = state.entries.get(key);
    if (!entry) return { ok: false, code: "not-found" };
    if (entry.status === "conflict") return { ok: false, code: "in-conflict" };
    entry.status = "queued";
    entry.rejectedCode = undefined;
    entry.failures = 0;
    state.retryAt.delete(key);
    return this.finish(state, key);
  }

  private newEntry(
    state: LibraryState,
    collection: Collection,
    id: string,
    want: PendingEntry["want"],
    baseRevision: number | null,
  ): PendingEntry {
    return {
      uid: state.uid,
      collection,
      id,
      want,
      baseRevision,
      queuedAt: this.now(),
      attempt: null,
      status: "queued",
      failures: 0,
    };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // unsent work and account data (rule 10)

  /** How many changes for `uid` never reached the cloud, from memory when it is the current account, else from storage. */
  async unsentChanges(uid: string): Promise<UnsentSummary> {
    const state = this.state;
    if (state && state.uid === uid && state.phase === "ready")
      return { count: state.entries.size, readable: true };
    try {
      const journal = parseJournal(
        uid,
        await this.enqueue(uid, () => this.storage.loadJournal(uid)),
      );
      return journal.ok
        ? { count: journal.entries.length, readable: true }
        : { count: 0, readable: false };
    } catch {
      return { count: 0, readable: false };
    }
  }

  /**
   * Account deletion (after the account is signed out): removes this device's cache and journal for `uid`. Refuses while
   * there is unsent work or the journal cannot be read, unless the caller says explicitly that it may be lost.
   */
  async forgetAccount(
    uid: string,
    options: { dropUnsent?: boolean } = {},
  ): Promise<
    | { ok: true; discarded: number }
    | {
        ok: false;
        code: "account-active" | "unsent-changes" | "unreadable";
        count: number;
      }
  > {
    if (this.session.current() === uid)
      return { ok: false, code: "account-active", count: 0 };
    const unsent = await this.unsentChanges(uid);
    if (!unsent.readable && !options.dropUnsent)
      return { ok: false, code: "unreadable", count: 0 };
    if (unsent.count > 0 && !options.dropUnsent)
      return { ok: false, code: "unsent-changes", count: unsent.count };
    await this.track(this.enqueue(uid, () => this.storage.removeAll(uid)));
    return { ok: true, discarded: unsent.count };
  }

  // -------------------------------------------------------------------------------------------------------------------
  // what the UI reads

  getSnapshot(): LibrarySnapshot {
    if (this.state) this.live(this.state);
    if (this.cached && this.cached.version === this.version)
      return this.cached.snapshot;
    const snapshot = this.build();
    this.cached = { version: this.version, snapshot };
    return snapshot;
  }

  private build(): LibrarySnapshot {
    const state = this.state;
    const counts: Record<ItemState, number> = {
      acknowledged: 0,
      pending: 0,
      retrying: 0,
      conflict: 0,
      rejected: 0,
    };
    const base: LibrarySnapshot = {
      version: this.version,
      account: state?.uid ?? null,
      phase: state ? state.phase : "signed-out",
      connection: state?.connection ?? "unknown",
      durable: state?.durable ?? true,
      routes: [],
      places: [],
      counts,
      unreadable: [],
      recovered: state?.recovered ?? { entries: 0, records: 0 },
    };
    if (!state) return base;
    if (state.unavailableReason)
      base.unavailableReason = state.unavailableReason;
    // Nothing is shown until the journal and cache for THIS account are loaded, and never for any other account.
    if (state.phase !== "ready") return base;
    const keys = [
      ...new Set([...state.confirmed.keys(), ...state.entries.keys()]),
    ].sort();
    for (const key of keys) {
      const record = state.confirmed.get(key) ?? null;
      const entry = state.entries.get(key) ?? null;
      let item: LibraryItem;
      if (!entry) {
        if (!record) continue;
        item = {
          key,
          collection: collectionOfRecord(record),
          id: record.id,
          value: contentOf(record),
          state: "acknowledged",
          change: "none",
          acknowledgedRevision: record.revision,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      } else {
        const value =
          entry.want.kind === "put"
            ? entry.want.content
            : record
              ? contentOf(record)
              : (entry.want.last ?? entry.attempt?.content ?? null);
        if (!value) continue;
        item = {
          key,
          collection: entry.collection,
          id: entry.id,
          value,
          state: entry.status === "queued" ? "pending" : entry.status,
          change:
            entry.want.kind === "delete"
              ? "delete"
              : entry.baseRevision === null
                ? "create"
                : "update",
          acknowledgedRevision: entry.baseRevision,
          createdAt: record?.createdAt ?? null,
          updatedAt: record?.updatedAt ?? null,
          ...(entry.conflict ? { conflict: entry.conflict } : {}),
          ...(entry.rejectedCode ? { rejectedCode: entry.rejectedCode } : {}),
        };
      }
      counts[item.state]++;
      (item.collection === "routes" ? base.routes : base.places).push(item);
    }
    for (const [key, code] of state.unreadable)
      base.unreadable.push({ key, code });
    return base;
  }
}
