// Public types and the three injected boundaries of the saved-library coordinator: the account session, the transport and
// the persistence. Nothing here knows about Firebase, a browser, React or a network; docs/web/saved-library-sync.md
// explains the model and the limits.
import type { PlaceRecord, RouteRecord } from "../contract";
import type { AccountKey } from "../ownership";

export type Collection = "routes" | "places";
export type CloudRecord = RouteRecord | PlaceRecord;

/** What a rider chooses to save: a record without the cloud's own bookkeeping (timestamps and revision). */
export type RouteContent = Omit<
  RouteRecord,
  "createdAt" | "updatedAt" | "revision"
>;
export type PlaceContent = Omit<
  PlaceRecord,
  "createdAt" | "updatedAt" | "revision"
>;
export type RecordContent = RouteContent | PlaceContent;

export interface RecordKey {
  collection: Collection;
  id: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// boundary 1: the account session (supplied by #32's sign-in; this slice never signs anyone in)

export interface AccountSession {
  /** The signed-in account's UID, or null when signed out. Read at every boundary, never cached across one. */
  current(): AccountKey;
  /** Called after EVERY change (sign-in, sign-out, switch, deletion). Returns an unsubscribe function. */
  subscribe(listener: (uid: AccountKey) => void): () => void;
}

// ---------------------------------------------------------------------------------------------------------------------
// boundary 2: the transport (a Firebase adapter in the real app, an in-memory server in tests)
//
// Every call names the account it is for. The transport must only ever touch `users/{uid}/...` for that uid; the
// coordinator checks what comes back anyway, and the Firestore rules refuse the rest independently.

/** One conditional write. `expectedRevision` is the revision the caller last saw; a mismatch must not write. */
export type WriteRequest =
  | {
      kind: "create";
      collection: Collection;
      id: string;
      content: RecordContent;
    }
  | {
      kind: "update";
      collection: Collection;
      id: string;
      content: RecordContent;
      expectedRevision: number;
    }
  | {
      kind: "delete";
      collection: Collection;
      id: string;
      expectedRevision: number;
    };

/**
 * What a write did. The distinction between `unavailable` and `unknown` is the safety-critical one:
 * - `unavailable`: the adapter can PROVE the request never reached the service (offline before sending, refused locally).
 * - `unknown`: the request may or may not have been applied (timeout, connection lost while waiting). When in doubt an
 *   adapter MUST answer `unknown`.
 * `precondition-failed` means the service evaluated the request and refused it: a create found the record, or an
 * update/delete found no record or a different revision. `rejected` is any other definitive refusal.
 */
export type WriteResult =
  | { kind: "committed"; record: unknown }
  | { kind: "deleted" }
  | { kind: "precondition-failed" }
  | { kind: "rejected"; code: string }
  | { kind: "unavailable" }
  | { kind: "unknown" };

export type ReadResult =
  | { kind: "found"; record: unknown }
  | { kind: "absent" }
  | { kind: "unavailable" };

export interface ListRequest {
  collection: Collection;
  /** At most LIMITS.listLimitMax: the rules refuse an unbounded list. */
  limit: number;
}
export type ListResult =
  | { kind: "ok"; readFor: string; records: unknown[]; complete: boolean }
  | { kind: "unavailable" };

/**
 * A listener delivery. `complete` means `records` is the whole collection, so a record missing from it was deleted; an
 * incomplete delivery only adds/updates records and names deletions in `removed`. A delivery served from a local cache
 * rather than the service must not be passed on.
 */
export interface SnapshotInput {
  readFor: string;
  complete: boolean;
  records: unknown[];
  removed: string[];
}
export interface ListenHandlers {
  onSnapshot(snapshot: SnapshotInput): void;
  onError(error: { code: string }): void;
}

export interface LibraryTransport {
  write(uid: string, request: WriteRequest): Promise<WriteResult>;
  /** An authoritative read of one record from the service (never a cache). */
  read(uid: string, collection: Collection, id: string): Promise<ReadResult>;
  list(uid: string, request: ListRequest): Promise<ListResult>;
  listen(
    uid: string,
    collection: Collection,
    handlers: ListenHandlers,
  ): () => void;
}

// ---------------------------------------------------------------------------------------------------------------------
// boundary 3: persistence (IndexedDB in the real app, memory in tests). Everything is keyed by UID, and the coordinator
// only ever asks for the current account's keys.

/** The unsent-work journal and the larger acknowledged-record cache are stored apart so each can be saved cheaply. */
export interface LibraryStorage {
  loadJournal(uid: string): Promise<unknown | null>;
  saveJournal(uid: string, journal: PersistedJournal): Promise<void>;
  loadCache(uid: string): Promise<unknown | null>;
  saveCache(uid: string, cache: PersistedCache): Promise<void>;
  removeCache(uid: string): Promise<void>;
  removeAll(uid: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------
// the journal: what is persisted

export type Want =
  | { kind: "put"; content: RecordContent }
  /** `last` is what was being deleted, so an unsent delete can always be shown (and explained) to the rider. */
  | { kind: "delete"; last?: RecordContent };

/** One request sent (or about to be sent) for a record. */
export interface Attempt {
  attemptId: string;
  kind: "create" | "update" | "delete";
  baseRevision: number | null;
  content: RecordContent | null;
  /**
   * True from the moment the request is written ahead to the journal until the transport proves it never reached the
   * service. After a reload an attempt that is still true is an attempt whose outcome nobody knows.
   */
  mayHaveApplied: boolean;
  /**
   * Contents of earlier attempts at this same base revision whose outcome is also unknown. If one of them landed, the
   * cloud holds one of these rather than `content`, and that still counts as the rider's own write, not a conflict.
   */
  earlier: RecordContent[];
}

export type ConflictCode =
  /** A create found a record with this id that is not the one that was sent. */
  | "already-exists"
  /** A create was sent, its outcome is unknown, and the record is not there: it may have been saved and deleted elsewhere. */
  | "possibly-deleted"
  /** An edit of a record that no longer exists in the cloud. */
  | "deleted-elsewhere"
  /** The cloud's copy moved on (another edit) since the change was based on it. */
  | "edited-elsewhere";

export interface Conflict {
  code: ConflictCode;
  /** The cloud's current record (null when it is gone), kept so the rider can compare. */
  remote: CloudRecord | null;
}

export type EntryStatus = "queued" | "retrying" | "conflict" | "rejected";

/** The rider's unsent change to one record. At most one per record; later edits replace `want`. */
export interface PendingEntry {
  uid: string;
  collection: Collection;
  id: string;
  want: Want;
  /** The cloud revision `want` is based on; null means the rider created the record and the cloud has not seen it. */
  baseRevision: number | null;
  queuedAt: number;
  attempt: Attempt | null;
  status: EntryStatus;
  /** Consecutive transient failures, for the retry delay. */
  failures: number;
  conflict?: Conflict;
  rejectedCode?: string;
}

export interface Tombstone {
  collection: Collection;
  id: string;
  /** Which incarnation of the id was deleted; null when it was not known. */
  createdAt: string | null;
  /** The highest revision seen before the delete: a snapshot at or below it is stale, not a resurrection. */
  revision: number;
}

export interface PersistedJournal {
  version: 1;
  uid: string;
  entries: PendingEntry[];
}
export interface PersistedCache {
  version: 1;
  uid: string;
  records: CloudRecord[];
  tombstones: Tombstone[];
}

// ---------------------------------------------------------------------------------------------------------------------
// what the coordinator exposes

/**
 * - acknowledged: the cloud accepted this value (a revision exists).
 * - pending: only on this device so far (saved locally, waiting to be sent or being sent).
 * - retrying: a send failed for a transient reason and will be tried again.
 * - conflict: the cloud's copy disagrees; nothing is sent until the rider chooses.
 * - rejected: the cloud refused the change; it is kept until the rider retries or discards it.
 */
export type ItemState =
  | "acknowledged"
  | "pending"
  | "retrying"
  | "conflict"
  | "rejected";

export interface LibraryItem {
  key: string;
  collection: Collection;
  id: string;
  /** The rider's own value when there is an unsent change, otherwise the cloud's. Never null for a visible item. */
  value: RecordContent;
  state: ItemState;
  /** What the unsent change is; "none" for an acknowledged item. A "delete" item is still shown, marked as deleting. */
  change: "none" | "create" | "update" | "delete";
  /** The cloud revision `value` is based on, or null for a record the cloud has never acknowledged. */
  acknowledgedRevision: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  conflict?: Conflict;
  rejectedCode?: string;
}

export type Phase =
  | "signed-out"
  | "loading"
  | "ready"
  /** The local journal could not be read or understood: nothing is shown, sent or overwritten until it can be. */
  | "unavailable";

export interface LibrarySnapshot {
  /** Increases on every change; usable as a store version. */
  version: number;
  account: AccountKey;
  phase: Phase;
  unavailableReason?: "storage-unavailable" | "journal-unsupported";
  /** What the last transport exchange showed. Not a promise about the network. */
  connection: "unknown" | "online" | "offline";
  /** False when the last attempt to save the journal locally failed: unsent changes would be lost on reload. */
  durable: boolean;
  routes: LibraryItem[];
  places: LibraryItem[];
  counts: Record<ItemState, number>;
  /** Records the cloud returned that this build cannot read (never shown). */
  unreadable: Array<{ key: string; code: string }>;
  /** Stored entries or cached records that were damaged and dropped on load. */
  recovered: { entries: number; records: number };
}

export type MutationError =
  | "signed-out"
  | "unavailable"
  | "account-changed"
  | "invalid"
  | "owner-mismatch"
  | "exists"
  | "not-found"
  | "deleted"
  | "in-conflict";

export type MutationResult =
  | {
      ok: true;
      key: string;
      /** True once the journal write completed: the change survives a reload. It is NOT cloud acceptance. */
      durable: boolean;
    }
  | { ok: false; code: MutationError; detail?: string };

export interface UnsentSummary {
  /** Changes that never reached the cloud (queued, retrying, conflicted or rejected). */
  count: number;
  readable: boolean;
}
