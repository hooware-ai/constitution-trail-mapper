// Test harness for the saved-library coordinator: an in-memory "cloud" that enforces the same rules the Firestore rules do
// (owner only, create-if-absent at revision 1, update at exactly revision + 1, validated records, hard deletes with no
// tombstone), a transport whose delivery tests can delay, drop, reorder and duplicate, and a manual clock. SYNTHETIC data
// only: every record comes from tests/support/cloud-fixtures.ts. Nothing here touches a network.
import {
  collectionOfRecord,
  contentOf,
  readRecord,
  recordKey,
} from "../../src/cloud/sync/content";
import { memoryStorage } from "../../src/cloud/sync/journal";
import { SavedLibraryCoordinator } from "../../src/cloud/sync/coordinator";
import type { AccountKey } from "../../src/cloud/ownership";
import type {
  AccountSession,
  CloudRecord,
  Collection,
  LibraryStorage,
  LibraryTransport,
  ListenHandlers,
  ListRequest,
  ListResult,
  ReadResult,
  RecordContent,
  SnapshotInput,
  WriteRequest,
  WriteResult,
} from "../../src/cloud/sync/types";
import { validPlaceRecord, validRouteRecord } from "./cloud-fixtures";

export const sleepTick = () => new Promise<void>((done) => setImmediate(done));

// ---------------------------------------------------------------------------------------------------------------------
// the cloud

export class FakeCloud {
  private docs = new Map<string, CloudRecord>();
  private clock = 0;
  private watchers = new Set<{
    uid: string;
    collection: Collection;
    notify: () => void;
  }>();
  /** Every request that reached the service, with whose account it was made under. */
  readonly applied: Array<{
    uid: string;
    kind: string;
    key: string;
    outcome: string;
  }> = [];
  /** A request whose path uid differed from the signed-in account: the real rules would refuse it. Must stay empty. */
  readonly violations: string[] = [];

  private time(): string {
    return new Date(
      Date.UTC(2026, 9, 1, 12, 0, 0) + ++this.clock * 1000,
    ).toISOString();
  }
  private path(uid: string, collection: Collection, id: string) {
    return `${uid}/${recordKey(collection, id)}`;
  }

  get(uid: string, collection: Collection, id: string): CloudRecord | null {
    return this.docs.get(this.path(uid, collection, id)) ?? null;
  }
  list(uid: string, collection: Collection): CloudRecord[] {
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith(`${uid}/${collection}/`))
      .map(([, record]) => record)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  ids(uid: string, collection: Collection): string[] {
    return this.list(uid, collection).map((record) => record.id);
  }

  /** The rules, as code: what a signed-in `auth` account may do under `users/{uid}/...`. */
  commit(auth: AccountKey, uid: string, request: WriteRequest): WriteResult {
    const key = recordKey(request.collection, request.id);
    const log = (outcome: string) =>
      this.applied.push({ uid, kind: request.kind, key, outcome });
    if (auth === null || auth !== uid) {
      this.violations.push(`${request.kind} ${key} for ${uid} as ${auth}`);
      log("permission-denied");
      return { kind: "rejected", code: "permission-denied" };
    }
    const path = this.path(uid, request.collection, request.id);
    const held = this.docs.get(path);
    if (request.kind === "delete") {
      if (!held || held.revision !== request.expectedRevision) {
        log("precondition-failed");
        return { kind: "precondition-failed" };
      }
      this.docs.delete(path);
      this.changed(uid, request.collection);
      log("deleted");
      return { kind: "deleted" };
    }
    if (
      request.kind === "create"
        ? held
        : !held || held.revision !== request.expectedRevision
    ) {
      log("precondition-failed");
      return { kind: "precondition-failed" };
    }
    const at = this.time();
    const revision = request.kind === "create" ? 1 : held!.revision + 1;
    const candidate = {
      ...request.content,
      createdAt: held?.createdAt ?? at,
      updatedAt: at,
      revision,
    };
    const checked = readRecord(request.collection, candidate, uid);
    if (!checked.ok || checked.value.id !== request.id) {
      log("rejected");
      return { kind: "rejected", code: "invalid-argument" };
    }
    this.docs.set(path, checked.value);
    this.changed(uid, request.collection);
    log("committed");
    return { kind: "committed", record: structuredClone(checked.value) };
  }

  // ---- another device or admin acting on the cloud directly (no coordinator involved) ----
  put(record: CloudRecord) {
    this.docs.set(
      this.path(record.ownerUid, collectionOfRecord(record), record.id),
      record,
    );
    this.changed(record.ownerUid, collectionOfRecord(record));
  }
  /** A plain external delete (another client's hard delete). */
  erase(uid: string, collection: Collection, id: string) {
    this.docs.delete(this.path(uid, collection, id));
    this.changed(uid, collection);
  }
  /** Another client's successful conditional edit, applied exactly as the rules would. */
  edit(
    uid: string,
    collection: Collection,
    id: string,
    change: Partial<RecordContent>,
  ) {
    const held = this.get(uid, collection, id);
    if (!held) throw new Error("nothing to edit");
    const result = this.commit(uid, uid, {
      kind: "update",
      collection,
      id,
      content: { ...contentOf(held), ...change } as RecordContent,
      expectedRevision: held.revision,
    });
    if (result.kind !== "committed")
      throw new Error(`edit failed: ${result.kind}`);
  }

  watch(uid: string, collection: Collection, notify: () => void) {
    const watcher = { uid, collection, notify };
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }
  private changed(uid: string, collection: Collection) {
    for (const watcher of [...this.watchers])
      if (watcher.uid === uid && watcher.collection === collection)
        watcher.notify();
  }
  snapshot(uid: string, collection: Collection): SnapshotInput {
    return {
      readFor: uid,
      complete: true,
      records: structuredClone(this.list(uid, collection)),
      removed: [],
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// the transport

export type WriteBehavior =
  | "ok"
  /** Never reached the service, provably. */
  | "unavailable"
  /** Applied by the service, response lost. */
  | "lose-response"
  /** Never applied, but the caller cannot know. */
  | "drop-request"
  /** Applied now, response delivered when the test releases it. */
  | "hold-response"
  /** Applied only when the test releases it (a request delayed in the network). */
  | "hold-request"
  | { reject: string };

export interface Held {
  request: WriteRequest;
  release(): void;
}

export class FakeTransport implements LibraryTransport {
  online = true;
  readonly calls: Array<{ type: string; uid: string; detail?: string }> = [];
  readonly held: Held[] = [];
  holdSnapshots = false;
  private queue: Array<() => void> = [];
  private script: WriteBehavior[] = [];
  private readScript: Array<"unavailable" | "ok"> = [];
  private listeners = new Set<{
    uid: string;
    collection: Collection;
    handlers: ListenHandlers;
  }>();
  failListen = false;
  /** Called synchronously as a write is made, before it is applied: lets a test look at what was on disk by then. */
  beforeWrite: ((uid: string, request: WriteRequest) => void) | null = null;

  constructor(
    private cloud: FakeCloud,
    private auth: () => AccountKey,
  ) {}

  next(...behaviors: WriteBehavior[]) {
    this.script.push(...behaviors);
  }
  nextRead(...behaviors: Array<"unavailable" | "ok">) {
    this.readScript.push(...behaviors);
  }
  writesFor(uid: string) {
    return this.calls.filter(
      (call) => call.type === "write" && call.uid === uid,
    );
  }

  async write(uid: string, request: WriteRequest): Promise<WriteResult> {
    this.calls.push({
      type: "write",
      uid,
      detail: `${request.kind} ${request.collection}/${request.id}`,
    });
    this.beforeWrite?.(uid, request);
    const behavior = this.script.shift() ?? "ok";
    if (!this.online || behavior === "unavailable")
      return { kind: "unavailable" };
    if (typeof behavior === "object")
      return { kind: "rejected", code: behavior.reject };
    if (behavior === "drop-request") return { kind: "unknown" };
    if (behavior === "hold-request") {
      return new Promise((resolve) =>
        this.held.push({
          request,
          release: () => resolve(this.cloud.commit(this.auth(), uid, request)),
        }),
      );
    }
    const result = this.cloud.commit(this.auth(), uid, request);
    if (behavior === "lose-response") return { kind: "unknown" };
    if (behavior === "hold-response")
      return new Promise((resolve) =>
        this.held.push({ request, release: () => resolve(result) }),
      );
    return result;
  }

  async read(
    uid: string,
    collection: Collection,
    id: string,
  ): Promise<ReadResult> {
    this.calls.push({ type: "read", uid, detail: `${collection}/${id}` });
    if (!this.online || this.readScript.shift() === "unavailable")
      return { kind: "unavailable" };
    if (this.auth() !== uid) return { kind: "unavailable" };
    const record = this.cloud.get(uid, collection, id);
    return record
      ? { kind: "found", record: structuredClone(record) }
      : { kind: "absent" };
  }

  async list(uid: string, request: ListRequest): Promise<ListResult> {
    this.calls.push({ type: "list", uid, detail: request.collection });
    if (!this.online || this.auth() !== uid) return { kind: "unavailable" };
    const snapshot = this.cloud.snapshot(uid, request.collection);
    return {
      kind: "ok",
      readFor: uid,
      records: snapshot.records,
      complete: true,
    };
  }

  listen(uid: string, collection: Collection, handlers: ListenHandlers) {
    this.calls.push({ type: "listen", uid, detail: collection });
    if (this.failListen) throw new Error("listen refused");
    const entry = { uid, collection, handlers };
    this.listeners.add(entry);
    const stopWatching = this.cloud.watch(uid, collection, () =>
      this.push(entry),
    );
    if (this.online) queueMicrotask(() => this.push(entry));
    return () => {
      this.listeners.delete(entry);
      stopWatching();
    };
  }

  private push(entry: {
    uid: string;
    collection: Collection;
    handlers: ListenHandlers;
  }) {
    if (!this.online || !this.listeners.has(entry)) return;
    const snapshot = this.cloud.snapshot(entry.uid, entry.collection);
    this.deliver(() => entry.handlers.onSnapshot(snapshot));
  }
  private deliver(run: () => void) {
    if (this.holdSnapshots) this.queue.push(run);
    else queueMicrotask(run);
  }

  // ---- controls ----
  /** Delivers held snapshots, optionally in a chosen order (indexes into the held list) and optionally twice. */
  flushSnapshots(order?: number[], twice = false) {
    const pending = this.queue.splice(0);
    const run = order ? order.map((index) => pending[index]) : pending;
    for (const delivery of run) {
      delivery();
      if (twice) delivery();
    }
  }
  heldSnapshots() {
    return this.queue.length;
  }
  /** Hands the listeners an arbitrary delivery (forged, stale, for another account, malformed). */
  inject(collection: Collection, snapshot: unknown, uid?: string) {
    for (const entry of [...this.listeners])
      if (
        entry.collection === collection &&
        (uid === undefined || entry.uid === uid)
      )
        entry.handlers.onSnapshot(snapshot as SnapshotInput);
  }
  failListeners(code = "unavailable") {
    for (const entry of [...this.listeners]) entry.handlers.onError({ code });
  }
  /** Back online: every listener gets the current state again, like a real reconnect. */
  reconnect() {
    this.online = true;
    for (const entry of [...this.listeners]) this.push(entry);
  }
  listening(uid: string) {
    return [...this.listeners].filter((entry) => entry.uid === uid).length;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// the session, clock, storage faults and a device that ties them together

export class FakeSession implements AccountSession {
  private listeners = new Set<(uid: AccountKey) => void>();
  constructor(private uid: AccountKey = null) {}
  current() {
    return this.uid;
  }
  subscribe(listener: (uid: AccountKey) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(uid: AccountKey, notify = true) {
    this.uid = uid;
    if (notify) for (const listener of [...this.listeners]) listener(uid);
  }
}

export class ManualClock {
  time = 1_000_000;
  private tasks: Array<{ at: number; run: () => void; cancelled: boolean }> =
    [];
  now = () => this.time;
  schedule = (run: () => void, delayMs: number) => {
    const task = { at: this.time + delayMs, run, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  };
  waiting() {
    return this.tasks.filter((task) => !task.cancelled).length;
  }
  advance(ms: number) {
    this.time += ms;
    const due = this.tasks.filter(
      (task) => !task.cancelled && task.at <= this.time,
    );
    this.tasks = this.tasks.filter(
      (task) => task.cancelled || task.at > this.time,
    );
    for (const task of due.sort((a, b) => a.at - b.at)) task.run();
  }
}

/** A storage whose saves and loads tests can fail or hold. */
export function faultyStorage(base: LibraryStorage = memoryStorage()) {
  const faults = { failSave: false, failLoad: false, saves: 0 };
  const storage: LibraryStorage & {
    faults: typeof faults;
    base: LibraryStorage;
  } = {
    faults,
    base,
    async loadJournal(uid) {
      if (faults.failLoad) throw new Error("load failed");
      return base.loadJournal(uid);
    },
    async saveJournal(uid, journal) {
      faults.saves++;
      if (faults.failSave) throw new Error("save failed");
      return base.saveJournal(uid, journal);
    },
    async loadCache(uid) {
      if (faults.failLoad) throw new Error("load failed");
      return base.loadCache(uid);
    },
    saveCache: (uid, cache) => base.saveCache(uid, cache),
    removeCache: (uid) => base.removeCache(uid),
    removeAll: (uid) => base.removeAll(uid),
  };
  return storage;
}

export interface Device {
  name: string;
  clock: ManualClock;
  session: FakeSession;
  transport: FakeTransport;
  storage: ReturnType<typeof memoryStorage>;
  coordinator: SavedLibraryCoordinator;
  /** Lets every pending promise and microtask run until the engine is idle. */
  settle(): Promise<void>;
  items(
    collection?: Collection,
  ): ReturnType<SavedLibraryCoordinator["getSnapshot"]>["routes"];
}

export function makeDevice(
  cloud: FakeCloud,
  options: {
    name?: string;
    uid?: AccountKey;
    storage?:
      | ReturnType<typeof memoryStorage>
      | ReturnType<typeof faultyStorage>;
    clock?: ManualClock;
    start?: boolean;
    maxConcurrentWrites?: number;
    keepCacheOnSignOut?: boolean;
  } = {},
): Device {
  const clock = options.clock ?? new ManualClock();
  const session = new FakeSession(options.uid ?? null);
  const transport = new FakeTransport(cloud, () => session.current());
  const storage = (options.storage ?? memoryStorage()) as ReturnType<
    typeof memoryStorage
  >;
  let counter = 0;
  const name = options.name ?? "device";
  const coordinator = new SavedLibraryCoordinator({
    session,
    transport,
    storage,
    now: clock.now,
    randomId: () => `${name}-attempt-${++counter}`,
    schedule: clock.schedule,
    maxConcurrentWrites: options.maxConcurrentWrites,
    keepCacheOnSignOut: options.keepCacheOnSignOut,
  });
  const device: Device = {
    name,
    clock,
    session,
    transport,
    storage,
    coordinator,
    async settle() {
      // Ticks, not whenIdle(): a write a test is deliberately holding must not block the test.
      for (let round = 0; round < 40; round++) await sleepTick();
    },
    items(collection = "routes") {
      const snapshot = coordinator.getSnapshot();
      return collection === "routes" ? snapshot.routes : snapshot.places;
    },
  };
  if (options.start !== false) coordinator.start();
  return device;
}

// ---------------------------------------------------------------------------------------------------------------------
// synthetic content

export const routeId = (n: number) => `rt_${String(n).padStart(20, "0")}`;
export const placeId = (n: number) => `pl_${String(n).padStart(20, "0")}`;

export async function routeContent(
  uid: string,
  n: number,
  title = `Synthetic route ${n}`,
  extra: Partial<RecordContent> = {},
): Promise<RecordContent> {
  const record = await validRouteRecord(uid, { id: routeId(n), engine: false });
  return { ...contentOf(record), title, ...extra } as RecordContent;
}
export function placeContent(
  uid: string,
  n: number,
  label = `Synthetic place ${n}`,
): RecordContent {
  return {
    ...contentOf(validPlaceRecord(uid, placeId(n))),
    label,
  } as RecordContent;
}
