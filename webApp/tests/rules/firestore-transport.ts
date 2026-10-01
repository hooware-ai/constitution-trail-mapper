// A TEST-ONLY reference adapter from the coordinator's LibraryTransport to the local Firestore emulator. It is not part of
// the app and not shipped: the real adapter (with Firebase Auth, #32/#33) is later work. What it demonstrates is how the
// transport contract maps onto Firestore and the committed rules:
//
//  - create / update / delete are each ONE transaction that reads the record first, so "create only if absent" and "update
//    or delete only at revision N" are real preconditions. The rules alone cannot give a delete a precondition (they allow
//    an owner's delete unconditionally), so the transaction is what keeps a stale device from deleting a newer record.
//  - an outcome the adapter cannot prove is reported as `unknown`; only a refusal it saw is `rejected`.
//  - documents are converted to the interchange form (timestamps as RFC 3339, engine bytes as base64) at this boundary.
import {
  Bytes,
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from "firebase/firestore";
import { LIMITS } from "../../src/cloud/contract";
import type {
  Collection,
  LibraryTransport,
  ListenHandlers,
  ListRequest,
  ListResult,
  ReadResult,
  WriteRequest,
  WriteResult,
} from "../../src/cloud/sync/types";
import type { Db } from "./support";

class PreconditionFailed extends Error {}

/** A stored document in the interchange form the contract validators read. */
export function toInterchange(data: DocumentData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Timestamp) out[key] = value.toDate().toISOString();
    else if (value instanceof Bytes) out[key] = value.toBase64();
    else out[key] = value;
  }
  return out;
}

/** The document to store: content as given, server timestamps, engine as bytes (never client-chosen times). */
function toDocument(
  content: Record<string, unknown>,
  revision: number,
  createdAt: Timestamp | null,
): DocumentData {
  const { engine, ...rest } = content;
  return {
    ...rest,
    revision,
    createdAt: createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(typeof engine === "string"
      ? { engine: Bytes.fromBase64String(engine) }
      : {}),
  };
}

export function firestoreTransport(
  db: Db,
): LibraryTransport & { requests: string[] } {
  const requests: string[] = [];
  const pathOf = (uid: string, name: Collection, id: string) =>
    `users/${uid}/${name}/${id}`;
  return {
    requests,
    async write(uid: string, request: WriteRequest): Promise<WriteResult> {
      requests.push(
        `${request.kind} ${uid}/${request.collection}/${request.id}`,
      );
      const ref = doc(db, pathOf(uid, request.collection, request.id));
      try {
        await runTransaction(db, async (tx) => {
          const held = await tx.get(ref);
          if (request.kind === "create") {
            if (held.exists()) throw new PreconditionFailed();
            tx.set(
              ref,
              toDocument(request.content as Record<string, unknown>, 1, null),
            );
            return;
          }
          if (
            !held.exists() ||
            held.data().revision !== request.expectedRevision
          )
            throw new PreconditionFailed();
          if (request.kind === "delete") {
            tx.delete(ref);
            return;
          }
          tx.set(
            ref,
            toDocument(
              request.content as Record<string, unknown>,
              request.expectedRevision + 1,
              held.data().createdAt as Timestamp,
            ),
          );
        });
      } catch (error) {
        if (error instanceof PreconditionFailed)
          return { kind: "precondition-failed" };
        const code = (error as { code?: string }).code;
        if (code === "permission-denied" || code === "invalid-argument")
          return { kind: "rejected", code };
        // Anything else may or may not have been applied: say so.
        return { kind: "unknown" };
      }
      if (request.kind === "delete") return { kind: "deleted" };
      try {
        const stored = await getDoc(ref);
        return stored.exists()
          ? { kind: "committed", record: toInterchange(stored.data()) }
          : { kind: "unknown" };
      } catch {
        return { kind: "unknown" };
      }
    },
    async read(uid: string, name: Collection, id: string): Promise<ReadResult> {
      requests.push(`read ${uid}/${name}/${id}`);
      try {
        const held = await getDoc(doc(db, pathOf(uid, name, id)));
        return held.exists()
          ? { kind: "found", record: toInterchange(held.data()) }
          : { kind: "absent" };
      } catch {
        return { kind: "unavailable" };
      }
    },
    async list(uid: string, request: ListRequest): Promise<ListResult> {
      requests.push(`list ${uid}/${request.collection}`);
      try {
        const snapshot = await getDocs(
          query(
            collection(db, `users/${uid}/${request.collection}`),
            limit(Math.min(request.limit, LIMITS.listLimitMax)),
          ),
        );
        return {
          kind: "ok",
          readFor: uid,
          records: snapshot.docs.map((held) => toInterchange(held.data())),
          complete: snapshot.size < request.limit,
        };
      } catch {
        return { kind: "unavailable" };
      }
    },
    listen(uid: string, name: Collection, handlers: ListenHandlers) {
      requests.push(`listen ${uid}/${name}`);
      return onSnapshot(
        query(
          collection(db, `users/${uid}/${name}`),
          limit(LIMITS.listLimitMax),
        ),
        (snapshot) => {
          // A delivery from a local cache is not the service's word; only server-confirmed state is passed on.
          if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
            return;
          handlers.onSnapshot({
            readFor: uid,
            complete: snapshot.size < LIMITS.listLimitMax,
            records: snapshot.docs.map((held) => toInterchange(held.data())),
            removed: [],
          });
        },
        (error) =>
          handlers.onError({
            code: (error as { code?: string }).code ?? "unknown",
          }),
      );
    },
  };
}
