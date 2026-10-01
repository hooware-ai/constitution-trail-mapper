// Reading the persisted journal and cache back. Storage is an input like any other: it may be damaged, from a newer
// build, or (through a bug elsewhere) hold another account's entries. Nothing is trusted until it parses under the
// contract AND names the account it is being loaded for; anything else is dropped and counted, never sent.
import { ID_PATTERN } from "../contract";
import { readRecord } from "./content";
import type {
  Attempt,
  CloudRecord,
  Collection,
  Conflict,
  ConflictCode,
  EntryStatus,
  LibraryStorage,
  PendingEntry,
  PersistedCache,
  PersistedJournal,
  RecordContent,
  Tombstone,
  Want,
} from "./types";

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const collections: readonly Collection[] = ["routes", "places"];
const statuses: readonly EntryStatus[] = [
  "queued",
  "retrying",
  "conflict",
  "rejected",
];
const conflictCodes: readonly ConflictCode[] = [
  "already-exists",
  "possibly-deleted",
  "deleted-elsewhere",
  "edited-elsewhere",
];
const revision = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

function parseContent(
  collection: Collection,
  raw: unknown,
  uid: string,
): RecordContent | null {
  if (!isObject(raw)) return null;
  const read = readRecord(
    collection,
    {
      ...raw,
      createdAt: "1970-01-01T00:00:00Z",
      updatedAt: "1970-01-01T00:00:00Z",
      revision: 1,
    },
    uid,
  );
  if (!read.ok) return null;
  const { createdAt: _c, updatedAt: _u, revision: _r, ...content } = read.value;
  return content as RecordContent;
}

function parseAttempt(
  collection: Collection,
  raw: unknown,
  uid: string,
): Attempt | null | undefined {
  if (raw === null) return null;
  if (!isObject(raw)) return undefined;
  if (
    typeof raw.attemptId !== "string" ||
    !["create", "update", "delete"].includes(String(raw.kind)) ||
    !(raw.baseRevision === null || revision(raw.baseRevision)) ||
    typeof raw.mayHaveApplied !== "boolean"
  )
    return undefined;
  const content =
    raw.content === null ? null : parseContent(collection, raw.content, uid);
  if (raw.kind === "delete" ? content !== null : content === null)
    return undefined;
  const earlier: RecordContent[] = [];
  if (raw.earlier !== undefined) {
    if (!Array.isArray(raw.earlier)) return undefined;
    for (const item of raw.earlier) {
      const parsed = parseContent(collection, item, uid);
      if (!parsed) return undefined;
      earlier.push(parsed);
    }
  }
  return {
    attemptId: raw.attemptId,
    kind: raw.kind as Attempt["kind"],
    baseRevision: raw.baseRevision as number | null,
    content,
    mayHaveApplied: raw.mayHaveApplied,
    earlier,
  };
}

function parseConflict(
  collection: Collection,
  raw: unknown,
  uid: string,
): Conflict | undefined {
  if (!isObject(raw) || !conflictCodes.includes(raw.code as ConflictCode))
    return undefined;
  if (raw.remote === null)
    return { code: raw.code as ConflictCode, remote: null };
  const read = readRecord(collection, raw.remote, uid);
  return read.ok
    ? { code: raw.code as ConflictCode, remote: read.value }
    : undefined;
}

/** One stored entry for `uid`, or null when it is damaged or belongs to anyone else. */
export function parseEntry(uid: string, raw: unknown): PendingEntry | null {
  if (!isObject(raw) || raw.uid !== uid) return null;
  if (
    !collections.includes(raw.collection as Collection) ||
    typeof raw.id !== "string" ||
    !ID_PATTERN.test(raw.id) ||
    !statuses.includes(raw.status as EntryStatus) ||
    !(raw.baseRevision === null || revision(raw.baseRevision)) ||
    typeof raw.queuedAt !== "number" ||
    !Number.isFinite(raw.queuedAt) ||
    typeof raw.failures !== "number" ||
    !Number.isInteger(raw.failures) ||
    raw.failures < 0 ||
    !isObject(raw.want)
  )
    return null;
  const collection = raw.collection as Collection;
  let want: Want;
  if (raw.want.kind === "delete") {
    const last =
      raw.want.last === undefined
        ? undefined
        : parseContent(collection, raw.want.last, uid);
    if (raw.want.last !== undefined && !last) return null;
    want = last ? { kind: "delete", last } : { kind: "delete" };
  } else if (raw.want.kind === "put") {
    const content = parseContent(collection, raw.want.content, uid);
    if (!content || content.id !== raw.id) return null;
    want = { kind: "put", content };
  } else return null;
  const attempt = parseAttempt(collection, raw.attempt, uid);
  if (attempt === undefined) return null;
  if (attempt && attempt.content && attempt.content.id !== raw.id) return null;
  const entry: PendingEntry = {
    uid,
    collection,
    id: raw.id,
    want,
    baseRevision: raw.baseRevision as number | null,
    queuedAt: raw.queuedAt,
    attempt,
    status: raw.status as EntryStatus,
    failures: raw.failures,
  };
  if (raw.status === "conflict") {
    const conflict = parseConflict(collection, raw.conflict, uid);
    if (!conflict) return null;
    entry.conflict = conflict;
  }
  if (raw.status === "rejected") {
    if (typeof raw.rejectedCode !== "string") return null;
    entry.rejectedCode = raw.rejectedCode;
  }
  return entry;
}

export type LoadedJournal =
  | { ok: true; entries: PendingEntry[]; dropped: number }
  | { ok: false; reason: "journal-unsupported" };

export function parseJournal(uid: string, raw: unknown): LoadedJournal {
  if (raw === null || raw === undefined)
    return { ok: true, entries: [], dropped: 0 };
  // A journal this build cannot understand as a whole is never overwritten: it may hold a newer build's unsent work.
  if (
    !isObject(raw) ||
    raw.version !== 1 ||
    raw.uid !== uid ||
    !Array.isArray(raw.entries)
  )
    return { ok: false, reason: "journal-unsupported" };
  const entries: PendingEntry[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of raw.entries) {
    const entry = parseEntry(uid, item);
    const key = entry ? `${entry.collection}/${entry.id}` : "";
    if (!entry || seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    entries.push(entry);
  }
  return { ok: true, entries, dropped };
}

export interface LoadedCache {
  records: CloudRecord[];
  tombstones: Tombstone[];
  dropped: number;
}
/** The cache is only a convenience: anything unreadable in it is dropped and refilled from the cloud. */
export function parseCache(uid: string, raw: unknown): LoadedCache {
  const empty: LoadedCache = { records: [], tombstones: [], dropped: 0 };
  if (raw === null || raw === undefined) return empty;
  if (!isObject(raw) || raw.version !== 1 || raw.uid !== uid)
    return { ...empty, dropped: 1 };
  const out: LoadedCache = { records: [], tombstones: [], dropped: 0 };
  const records = Array.isArray(raw.records) ? raw.records : [];
  const seen = new Set<string>();
  for (const item of records) {
    const collection = isObject(item)
      ? item.schema === "trail-mapper.saved-route"
        ? "routes"
        : item.schema === "trail-mapper.saved-place"
          ? "places"
          : null
      : null;
    const read = collection ? readRecord(collection, item, uid) : null;
    const key = read?.ok ? `${collection}/${read.value.id}` : "";
    if (!read || !read.ok || seen.has(key)) {
      out.dropped++;
      continue;
    }
    seen.add(key);
    out.records.push(read.value);
  }
  const tombstones = Array.isArray(raw.tombstones) ? raw.tombstones : [];
  for (const item of tombstones) {
    if (
      isObject(item) &&
      collections.includes(item.collection as Collection) &&
      typeof item.id === "string" &&
      ID_PATTERN.test(item.id) &&
      (item.createdAt === null || typeof item.createdAt === "string") &&
      revision(item.revision)
    )
      out.tombstones.push({
        collection: item.collection as Collection,
        id: item.id,
        createdAt: item.createdAt as string | null,
        revision: item.revision,
      });
    else out.dropped++;
  }
  return out;
}

/** A storage that keeps everything in memory (tests, and a reference for the real adapter). Values are JSON-copied. */
export function memoryStorage(): LibraryStorage & {
  journals: Map<string, string>;
  caches: Map<string, string>;
} {
  const journals = new Map<string, string>();
  const caches = new Map<string, string>();
  const parse = (text: string | undefined) =>
    text === undefined ? null : (JSON.parse(text) as unknown);
  return {
    journals,
    caches,
    async loadJournal(uid) {
      return parse(journals.get(uid));
    },
    async saveJournal(uid, journal: PersistedJournal) {
      journals.set(uid, JSON.stringify(journal));
    },
    async loadCache(uid) {
      return parse(caches.get(uid));
    },
    async saveCache(uid, cache: PersistedCache) {
      caches.set(uid, JSON.stringify(cache));
    },
    async removeCache(uid) {
      caches.delete(uid);
    },
    async removeAll(uid) {
      journals.delete(uid);
      caches.delete(uid);
    },
  };
}
