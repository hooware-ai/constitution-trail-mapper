// Account-aware ownership rules for the saved library: which results and pending writes may touch which account's view.
// This is the specification, as small pure code, that a later Firebase adapter must satisfy. It is NOT wired into the app:
// there is no sign-in, no observation and no sync in this build, and nothing here talks to a network.
//
// The failure it prevents: a Firestore listener, a one-shot read or a queued write that was started for account A is
// delivered after the rider switched to B (or signed out), and A's records or A's outcome show up in B's library.

/** `null` means signed out. */
export type AccountKey = string | null;

export interface ObservationToken {
  readonly epoch: number;
  readonly uid: AccountKey;
}

/** One counter that moves on every account change; anything started under an older value is stale. */
export class AccountEpochs {
  private epoch = 0;
  private uid: AccountKey = null;
  get account(): AccountKey {
    return this.uid;
  }
  /** Sign-in, sign-out, an account switch or an account deletion. Same account again changes nothing. */
  switchTo(uid: AccountKey): ObservationToken {
    if (uid !== this.uid) {
      this.epoch++;
      this.uid = uid;
    }
    return this.token();
  }
  /** Capture before starting any read, listener or write; present when its result arrives. */
  token(): ObservationToken {
    return { epoch: this.epoch, uid: this.uid };
  }
  /** A result may be shown only if the account has not changed since its token was captured. */
  isCurrent(token: ObservationToken): boolean {
    return token.epoch === this.epoch && token.uid === this.uid;
  }
}

/** What a snapshot says about who it belongs to, e.g. the uid in the path it was read from. */
export interface Delivery<T> {
  token: ObservationToken;
  /** The account the data was actually read for (from its path), checked against the token as well. */
  readFor: string;
  records: readonly T[];
}
/**
 * Returns the records to show, or null to drop the delivery. A delivery is dropped when the account changed since it
 * was requested, when it was requested for nobody, or when it was read for a different account than it claims.
 */
export function acceptDelivery<T extends { ownerUid: string }>(
  epochs: AccountEpochs,
  delivery: Delivery<T>,
): readonly T[] | null {
  if (!epochs.isCurrent(delivery.token)) return null;
  if (delivery.token.uid === null || delivery.readFor !== delivery.token.uid)
    return null;
  // A record that is not the account's own is never shown, even inside an otherwise accepted delivery.
  return delivery.records.filter(
    (record) => record.ownerUid === delivery.token.uid,
  );
}

export interface PendingWrite {
  opId: string;
  /** The account the write was made under; it can only ever be replayed or settled for this account. */
  uid: string;
  collection: "routes" | "places";
  recordId: string;
  op: "create" | "update" | "delete";
  /** The revision the write was based on (null for a create): the rules refuse it if that is no longer current. */
  baseRevision: number | null;
  queuedAt: number;
}
export type WriteOutcome =
  | { kind: "committed"; revision: number }
  | { kind: "conflict" }
  | { kind: "deleted-elsewhere" }
  | { kind: "rejected"; code: string };

/**
 * Pending writes belong to the account that made them. Signing out or switching keeps them (ordinary sign-out never
 * deletes cloud saves or loses an unsent save) but they are invisible to, and never sent for, any other account.
 */
export class PendingWrites {
  private byUid = new Map<string, PendingWrite[]>();
  private serial = 0;

  enqueue(
    write: Omit<PendingWrite, "opId" | "queuedAt">,
    now = Date.now(),
  ): PendingWrite {
    const entry: PendingWrite = {
      ...write,
      opId: `op-${++this.serial}`,
      queuedAt: now,
    };
    this.byUid.set(write.uid, [...(this.byUid.get(write.uid) ?? []), entry]);
    return entry;
  }
  /** What may be shown or sent for `account`: its own writes, and nothing when signed out. */
  forAccount(account: AccountKey): readonly PendingWrite[] {
    return account === null ? [] : (this.byUid.get(account) ?? []);
  }
  /**
   * Records the outcome of a write. It always settles the ledger of the account that made it, so a late callback after an
   * account switch cannot be applied to the wrong library; `visible` says whether that account is the one on screen.
   */
  settle(
    epochs: AccountEpochs,
    uid: string,
    opId: string,
    outcome: WriteOutcome,
  ): { settled: PendingWrite | null; visible: boolean; keep: boolean } {
    const list = this.byUid.get(uid) ?? [];
    const settled = list.find((entry) => entry.opId === opId) ?? null;
    if (!settled) return { settled: null, visible: false, keep: false };
    // A rejection or a conflict stays for the rider to resolve (never silently dropped or retried as someone else);
    // a commit or a deleted-elsewhere result ends the write.
    const keep = outcome.kind === "conflict" || outcome.kind === "rejected";
    if (!keep)
      this.byUid.set(
        uid,
        list.filter((entry) => entry.opId !== opId),
      );
    return { settled, visible: epochs.account === uid, keep };
  }
  /** Account deletion: every pending write for that account goes with it. */
  discardAccount(uid: string): number {
    const count = (this.byUid.get(uid) ?? []).length;
    this.byUid.delete(uid);
    return count;
  }
}
