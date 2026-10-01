import test from "node:test";
import assert from "node:assert/strict";
import {
  AccountEpochs,
  PendingWrites,
  acceptDelivery,
  type ObservationToken,
} from "../../src/cloud/ownership";

const record = (ownerUid: string, id = "r1") => ({ ownerUid, id });

test("a result for the previous account is dropped after an account switch, even if it arrives late", () => {
  const epochs = new AccountEpochs();
  epochs.switchTo("alice");
  const token = epochs.token();
  epochs.switchTo("bob");
  assert.equal(
    acceptDelivery(epochs, {
      token,
      readFor: "alice",
      records: [record("alice")],
    }),
    null,
  );
  // Switching back does not revive it either: it is a new session with a new epoch.
  epochs.switchTo("alice");
  assert.equal(
    acceptDelivery(epochs, {
      token,
      readFor: "alice",
      records: [record("alice")],
    }),
    null,
  );
});

test("a result is dropped after sign-out and for a delivery requested while signed out", () => {
  const epochs = new AccountEpochs();
  const signedOutToken = epochs.token();
  assert.equal(
    acceptDelivery(epochs, {
      token: signedOutToken,
      readFor: "alice",
      records: [record("alice")],
    }),
    null,
  );
  epochs.switchTo("alice");
  const token = epochs.token();
  epochs.switchTo(null);
  assert.equal(
    acceptDelivery(epochs, {
      token,
      readFor: "alice",
      records: [record("alice")],
    }),
    null,
  );
});

test("a current delivery is shown, but only records that belong to the account, and only if read for it", () => {
  const epochs = new AccountEpochs();
  epochs.switchTo("alice");
  const token = epochs.token();
  const shown = acceptDelivery(epochs, {
    token,
    readFor: "alice",
    records: [record("alice", "a"), record("bob", "b")],
  });
  assert.deepEqual(shown, [record("alice", "a")]);
  assert.equal(
    acceptDelivery(epochs, { token, readFor: "bob", records: [record("bob")] }),
    null,
  );
  // Re-asserting the same account does not invalidate in-flight work.
  const same: ObservationToken = epochs.switchTo("alice");
  assert.ok(epochs.isCurrent(token));
  assert.ok(epochs.isCurrent(same));
});

test("pending writes stay with the account that made them: invisible to others, kept across sign-out, never replayed as someone else", () => {
  const epochs = new AccountEpochs();
  const pending = new PendingWrites();
  epochs.switchTo("alice");
  const write = pending.enqueue({
    uid: "alice",
    collection: "routes",
    recordId: "r1",
    op: "create",
    baseRevision: null,
  });
  assert.equal(pending.forAccount("alice").length, 1);
  epochs.switchTo("bob");
  assert.equal(pending.forAccount("bob").length, 0);
  assert.equal(pending.forAccount(null).length, 0);
  epochs.switchTo(null);
  assert.equal(
    pending.forAccount("alice").length,
    1,
    "ordinary sign-out keeps an unsent save",
  );
  // A late commit for alice's write, after bob signed in, settles alice's ledger and is not visible to bob.
  epochs.switchTo("bob");
  const result = pending.settle(epochs, "alice", write.opId, {
    kind: "committed",
    revision: 1,
  });
  assert.equal(result.settled?.opId, write.opId);
  assert.equal(result.visible, false);
  assert.equal(pending.forAccount("alice").length, 0);
});

test("a conflict or rejection stays for the rider to resolve; a commit or a deletion elsewhere ends the write", () => {
  const epochs = new AccountEpochs();
  const pending = new PendingWrites();
  epochs.switchTo("alice");
  const edit = pending.enqueue({
    uid: "alice",
    collection: "routes",
    recordId: "r1",
    op: "update",
    baseRevision: 1,
  });
  assert.equal(
    pending.settle(epochs, "alice", edit.opId, { kind: "conflict" }).keep,
    true,
  );
  assert.equal(pending.forAccount("alice").length, 1);
  assert.equal(
    pending.settle(epochs, "alice", edit.opId, {
      kind: "rejected",
      code: "permission-denied",
    }).keep,
    true,
  );
  const gone = pending.settle(epochs, "alice", edit.opId, {
    kind: "deleted-elsewhere",
  });
  assert.equal(gone.keep, false);
  assert.equal(gone.visible, true);
  assert.equal(pending.forAccount("alice").length, 0);
  // Settling an unknown or already-settled write is harmless.
  assert.equal(
    pending.settle(epochs, "alice", "op-999", { kind: "conflict" }).settled,
    null,
  );
});

test("deleting an account removes its pending writes and nobody else's", () => {
  const epochs = new AccountEpochs();
  const pending = new PendingWrites();
  pending.enqueue({
    uid: "alice",
    collection: "places",
    recordId: "p1",
    op: "create",
    baseRevision: null,
  });
  pending.enqueue({
    uid: "alice",
    collection: "routes",
    recordId: "r1",
    op: "delete",
    baseRevision: 2,
  });
  pending.enqueue({
    uid: "bob",
    collection: "places",
    recordId: "p9",
    op: "create",
    baseRevision: null,
  });
  assert.equal(pending.discardAccount("alice"), 2);
  assert.equal(pending.forAccount("alice").length, 0);
  assert.equal(pending.forAccount("bob").length, 1);
  void epochs;
});
