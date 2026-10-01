import test from "node:test";
import assert from "node:assert/strict";
import {
  FakeCloud,
  makeDevice,
  routeContent,
  routeId,
  type Device,
} from "../support/cloud-sync-harness";
import { memoryStorage } from "../../src/cloud/sync/journal";
import { contentOf } from "../../src/cloud/sync/content";
import { validRouteRecord } from "../support/cloud-fixtures";

const route = (n: number) => ({
  collection: "routes" as const,
  id: routeId(n),
});
const title = (cloud: FakeCloud, n: number) =>
  (cloud.get("alice", "routes", routeId(n)) as { title: string } | null)?.title;
const createsApplied = (cloud: FakeCloud) =>
  cloud.applied.filter(
    (entry) => entry.kind === "create" && entry.outcome === "committed",
  ).length;
const stateOf = (device: Device, n = 1) =>
  device.items().find((item) => item.id === routeId(n));

/** Two devices of the same account that both hold route 1 at revision 1. */
async function twoDevices() {
  const cloud = new FakeCloud();
  const d1 = makeDevice(cloud, { name: "d1", uid: "alice" });
  const d2 = makeDevice(cloud, { name: "d2", uid: "alice" });
  await d1.settle();
  await d2.settle();
  await d1.coordinator.create(await routeContent("alice", 1, "Original"));
  await d1.settle();
  await d2.settle();
  assert.equal(stateOf(d2)?.state, "acknowledged");
  return { cloud, d1, d2 };
}

test("two devices edit the same revision: the first wins, the second is shown a conflict with its own edit intact, and nothing is overwritten", async () => {
  const { cloud, d1, d2 } = await twoDevices();
  d2.transport.online = false;
  await d2.coordinator.update(
    await routeContent("alice", 1, "Edit from device two"),
  );
  await d2.settle();
  await d1.coordinator.update(
    await routeContent("alice", 1, "Edit from device one"),
  );
  await d1.settle();
  const writes = d2.transport.writesFor("alice").length;
  d2.transport.reconnect();
  await d2.settle(); // the cloud's newer copy arrives first, so the conflict is recognised before anything is sent
  d2.coordinator.retryNow();
  await d2.settle();
  const item = stateOf(d2)!;
  assert.equal(item.state, "conflict");
  assert.equal(item.conflict?.code, "edited-elsewhere");
  assert.equal(item.conflict?.remote?.revision, 2);
  assert.equal(
    (item.value as { title: string }).title,
    "Edit from device two",
    "the rider's edit is kept",
  );
  assert.equal(
    title(cloud, 1),
    "Edit from device one",
    "the cloud was not overwritten",
  );
  assert.equal(
    d2.transport.writesFor("alice").length,
    writes,
    "no request was made on top of the other edit",
  );
  assert.equal(d2.coordinator.getSnapshot().counts.conflict, 1);

  // Nothing more can be done to it until the rider decides.
  assert.deepEqual(
    await d2.coordinator.update(await routeContent("alice", 1, "Another")),
    { ok: false, code: "in-conflict" },
  );
  assert.deepEqual(await d2.coordinator.remove(route(1)), {
    ok: false,
    code: "in-conflict",
  });
  d2.clock.advance(120_000);
  await d2.settle();
  assert.equal(title(cloud, 1), "Edit from device one");

  // keep-mine is explicit: it goes on top of the cloud's current revision.
  assert.ok((await d2.coordinator.resolveConflict(route(1), "keep-mine")).ok);
  await d2.settle();
  await d1.settle();
  assert.equal(title(cloud, 1), "Edit from device two");
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 3);
  assert.equal(stateOf(d2)!.state, "acknowledged");
  assert.equal(
    (stateOf(d1)!.value as { title: string }).title,
    "Edit from device two",
  );
});

test("a conflict is also found when the cloud refuses the write (no snapshot needed), and keep-theirs drops the local edit", async () => {
  const { cloud, d1, d2 } = await twoDevices();
  d2.transport.holdSnapshots = true;
  await d1.coordinator.update(
    await routeContent("alice", 1, "Edit from device one"),
  );
  await d1.settle();
  await d2.coordinator.update(
    await routeContent("alice", 1, "Edit from device two"),
  );
  await d2.settle();
  assert.equal(stateOf(d2)!.state, "conflict");
  assert.equal(stateOf(d2)!.conflict?.code, "edited-elsewhere");
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 2);
  assert.ok((await d2.coordinator.resolveConflict(route(1), "keep-theirs")).ok);
  await d2.settle();
  assert.equal(stateOf(d2)!.state, "acknowledged");
  assert.equal(
    (stateOf(d2)!.value as { title: string }).title,
    "Edit from device one",
  );
  assert.equal(title(cloud, 1), "Edit from device one");
  assert.equal((await d2.coordinator.unsentChanges("alice")).count, 0);
});

test("identical concurrent edits converge without a conflict", async () => {
  const { cloud, d1, d2 } = await twoDevices();
  d2.transport.online = false;
  await d2.coordinator.update(await routeContent("alice", 1, "Same title"));
  await d2.settle();
  await d1.coordinator.update(await routeContent("alice", 1, "Same title"));
  await d1.settle();
  d2.transport.reconnect();
  d2.coordinator.retryNow();
  await d2.settle();
  assert.equal(stateOf(d2)!.state, "acknowledged");
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 2);
  assert.equal(d2.coordinator.getSnapshot().counts.conflict, 0);
});

test("deletion race: a delete made offline does not delete a record edited elsewhere in the meantime, and keep-mine deletes it for good", async () => {
  const { cloud, d1, d2 } = await twoDevices();
  d1.transport.online = false;
  await d1.coordinator.remove(route(1));
  await d1.settle();
  await d2.coordinator.update(
    await routeContent("alice", 1, "Edited while the other device deleted"),
  );
  await d2.settle();
  d1.transport.reconnect();
  d1.coordinator.retryNow();
  await d1.settle();
  const item = stateOf(d1)!;
  assert.equal(item.state, "conflict");
  assert.equal(item.change, "delete");
  assert.equal(item.conflict?.code, "edited-elsewhere");
  assert.equal(
    title(cloud, 1),
    "Edited while the other device deleted",
    "still there",
  );

  assert.ok((await d1.coordinator.resolveConflict(route(1), "keep-mine")).ok);
  await d1.settle();
  await d2.settle();
  assert.equal(cloud.get("alice", "routes", routeId(1)), null);
  assert.equal(d1.items().length, 0);
  assert.equal(d2.items().length, 0);
  assert.equal(createsApplied(cloud), 1, "nothing was re-created");
});

test("deletion race: an edit made offline to a record deleted elsewhere is kept for the rider and never re-creates the record", async () => {
  const { cloud, d1, d2 } = await twoDevices();
  d1.transport.online = false;
  await d1.coordinator.update(
    await routeContent("alice", 1, "Edit after it was deleted"),
  );
  await d1.settle();
  await d2.coordinator.remove(route(1));
  await d2.settle();
  assert.equal(cloud.get("alice", "routes", routeId(1)), null);
  d1.transport.reconnect();
  d1.coordinator.retryNow();
  await d1.settle();
  const item = stateOf(d1)!;
  assert.equal(item.state, "conflict");
  assert.equal(item.conflict?.code, "deleted-elsewhere");
  assert.equal(item.conflict?.remote, null);
  assert.equal(
    (item.value as { title: string }).title,
    "Edit after it was deleted",
  );
  assert.equal(
    createsApplied(cloud),
    1,
    "the deleted record was not resurrected by the retry",
  );
  assert.equal(cloud.get("alice", "routes", routeId(1)), null);
  d1.clock.advance(120_000);
  await d1.settle();
  assert.equal(cloud.get("alice", "routes", routeId(1)), null);

  // Saving it again is possible only as the rider's explicit choice, and it is a new record incarnation.
  const originalCreatedAt = "2026-10-01T12:00:01.000Z";
  assert.ok((await d1.coordinator.resolveConflict(route(1), "keep-mine")).ok);
  await d1.settle();
  const again = cloud.get("alice", "routes", routeId(1))!;
  assert.equal(again.revision, 1);
  assert.notEqual(again.createdAt, originalCreatedAt);
  assert.equal(createsApplied(cloud), 2);
});

test("an edit of a record deleted elsewhere is found even when the cloud itself has to refuse it", async () => {
  const { cloud, d1, d2 } = await twoDevices();
  d1.transport.holdSnapshots = true;
  await d2.coordinator.remove(route(1));
  await d2.settle();
  await d1.coordinator.update(await routeContent("alice", 1, "Too late"));
  await d1.settle();
  assert.equal(stateOf(d1)!.conflict?.code, "deleted-elsewhere");
  assert.equal(createsApplied(cloud), 1);
  assert.ok((await d1.coordinator.resolveConflict(route(1), "keep-theirs")).ok);
  await d1.settle();
  assert.equal(d1.items().length, 0);
  assert.equal(cloud.get("alice", "routes", routeId(1)), null);
});

test("hard deletes leave no tombstone, so a create whose outcome is unknown is never replayed blindly: if the record is gone it is a conflict, not a re-creation", async () => {
  const cloud = new FakeCloud();
  const d1 = makeDevice(cloud, { name: "d1", uid: "alice" });
  const d2 = makeDevice(cloud, { name: "d2", uid: "alice" });
  await d1.settle();
  await d2.settle();
  d1.transport.next("lose-response");
  await d1.coordinator.create(
    await routeContent("alice", 1, "Saved then lost"),
  );
  await d1.settle();
  assert.equal(createsApplied(cloud), 1);
  await d2.settle();
  assert.equal(stateOf(d2)?.state, "acknowledged", "the other device saw it");
  await d2.coordinator.remove(route(1));
  await d2.settle();
  assert.equal(cloud.get("alice", "routes", routeId(1)), null);

  d1.clock.advance(1000);
  await d1.settle();
  assert.equal(
    createsApplied(cloud),
    1,
    "the retry did not create the deleted record again",
  );
  assert.equal(cloud.get("alice", "routes", routeId(1)), null);
  assert.equal(stateOf(d1)!.state, "conflict");
  assert.equal(stateOf(d1)!.conflict?.code, "possibly-deleted");
  assert.equal(
    d1.transport.writesFor("alice").length,
    1,
    "only the original attempt was ever sent",
  );
});

test("the scenario above is real: the service itself would accept a blind replay, which is why the protection lives in the client", async () => {
  const cloud = new FakeCloud();
  const content = await routeContent("alice", 1);
  const create = {
    kind: "create" as const,
    collection: "routes" as const,
    id: routeId(1),
    content,
  };
  assert.equal(cloud.commit("alice", "alice", create).kind, "committed");
  cloud.erase("alice", "routes", routeId(1));
  // A client that simply retried its create would bring the deleted record back.
  assert.equal(cloud.commit("alice", "alice", create).kind, "committed");
});

test("a create of unknown outcome that finds the record absent after a reload is a conflict the rider resolves; keep-mine saves it again explicitly", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const first = makeDevice(cloud, { uid: "alice", storage });
  await first.settle();
  first.transport.next("drop-request"); // never applied, but nobody can tell
  await first.coordinator.create(await routeContent("alice", 1, "Maybe saved"));
  await first.settle();
  await first.coordinator.stop();

  const second = makeDevice(cloud, { uid: "alice", storage });
  await second.settle();
  assert.equal(createsApplied(cloud), 0, "not blindly retried");
  assert.equal(stateOf(second)!.state, "conflict");
  assert.equal(stateOf(second)!.conflict?.code, "possibly-deleted");
  assert.ok(
    (await second.coordinator.resolveConflict(route(1), "keep-mine")).ok,
  );
  await second.settle();
  assert.equal(createsApplied(cloud), 1);
  assert.equal(stateOf(second)!.state, "acknowledged");
});

test("a create of unknown outcome that finds a different record under its id is a conflict showing what is there", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  device.transport.next("drop-request");
  await device.coordinator.create(await routeContent("alice", 1, "Mine"));
  await device.settle();
  cloud.put(await validRouteRecord("alice", { id: routeId(1), engine: false }));
  device.clock.advance(1000);
  await device.settle();
  assert.equal(stateOf(device)!.state, "conflict");
  assert.equal(stateOf(device)!.conflict?.code, "already-exists");
  assert.equal(stateOf(device)!.conflict?.remote?.revision, 1);
  assert.equal(createsApplied(cloud), 0);
});

test("a record removed while its create was of unknown outcome is deleted once the create is confirmed, or simply forgotten if it never landed", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  device.transport.next("lose-response");
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  await device.coordinator.remove(route(1));
  device.clock.advance(1000);
  await device.settle();
  assert.equal(cloud.get("alice", "routes", routeId(1)), null);
  assert.equal(device.items().length, 0);
  assert.equal(device.coordinator.getSnapshot().counts.conflict, 0);
  assert.equal((await device.coordinator.unsentChanges("alice")).count, 0);

  device.transport.next("drop-request");
  await device.coordinator.create(await routeContent("alice", 2));
  await device.settle();
  await device.coordinator.remove(route(2));
  device.clock.advance(5000);
  await device.settle();
  assert.equal(cloud.get("alice", "routes", routeId(2)), null);
  assert.equal(device.items().length, 0);
  assert.equal(createsApplied(cloud), 1);
});

test("deleting twice, from two devices, converges quietly", async () => {
  const { cloud, d1, d2 } = await twoDevices();
  d1.transport.online = false;
  d2.transport.online = false;
  await d1.coordinator.remove(route(1));
  await d2.coordinator.remove(route(1));
  await d1.settle();
  d1.transport.reconnect();
  d1.coordinator.retryNow();
  await d1.settle();
  assert.equal(cloud.get("alice", "routes", routeId(1)), null);
  d2.transport.reconnect();
  d2.coordinator.retryNow();
  await d2.settle();
  assert.equal(d2.coordinator.getSnapshot().counts.conflict, 0);
  assert.equal((await d2.coordinator.unsentChanges("alice")).count, 0);
  assert.equal(d2.items().length, 0);
});

test("a stale snapshot cannot bring a deleted record back, now or after a reload", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const d1 = makeDevice(cloud, { name: "d1", uid: "alice", storage });
  const d2 = makeDevice(cloud, { name: "d2", uid: "alice" });
  await d1.coordinator.create(await routeContent("alice", 1));
  await d1.settle();
  await d2.settle();
  const before = cloud.snapshot("alice", "routes"); // includes the record
  await d2.coordinator.remove(route(1));
  await d2.settle();
  await d1.settle();
  assert.equal(d1.items().length, 0);

  d1.transport.inject("routes", before);
  await d1.settle();
  assert.equal(d1.items().length, 0, "the older delivery was ignored");
  assert.ok(d1.coordinator.diagnostics().staleRecordsIgnored >= 1);

  await d1.coordinator.stop();
  const reloaded = makeDevice(cloud, { uid: "alice", storage });
  await reloaded.settle();
  reloaded.transport.inject("routes", before);
  await reloaded.settle();
  assert.equal(reloaded.items().length, 0, "still ignored after a reload");
});

test("an older snapshot that lacks a record cannot delete it: a deletion is believed only when the cloud confirms it", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  const empty = cloud.snapshot("alice", "routes");
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  device.transport.inject("routes", empty);
  await device.settle();
  assert.equal(device.items().length, 1);
  assert.equal(device.items()[0].state, "acknowledged");
  assert.ok(
    device.transport.calls.some((call) => call.type === "read"),
    "the cloud was asked",
  );

  // And when the cloud cannot be asked, the record stays.
  device.transport.nextRead("unavailable");
  device.transport.inject("routes", empty);
  await device.settle();
  assert.equal(device.items().length, 1);
  assert.equal(device.coordinator.getSnapshot().connection, "offline");
});

test("a record this build cannot read is never shown, never mistaken for a deletion, and its id cannot be taken", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  const record = cloud.get("alice", "routes", routeId(1))!;
  device.transport.inject("routes", {
    readFor: "alice",
    complete: true,
    records: [{ ...record, version: 2 }],
    removed: [],
  });
  await device.settle();
  assert.equal(device.items().length, 0);
  assert.deepEqual(device.coordinator.getSnapshot().unreadable, [
    { key: `routes/${routeId(1)}`, code: "unsupported-version" },
  ]);
  assert.deepEqual(
    await device.coordinator.create(await routeContent("alice", 1)),
    { ok: false, code: "exists" },
  );
  assert.equal(
    device.transport.calls.filter((call) => call.type === "read").length,
    0,
    "not treated as deleted",
  );
  // A later readable delivery restores it.
  device.transport.inject("routes", cloud.snapshot("alice", "routes"));
  await device.settle();
  assert.equal(device.items().length, 1);
  assert.deepEqual(device.coordinator.getSnapshot().unreadable, []);
});

test("a conflict survives a reload with the cloud's copy attached, and still blocks edits and sends", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const d1 = makeDevice(cloud, { name: "d1", uid: "alice" });
  const d2 = makeDevice(cloud, { name: "d2", uid: "alice", storage });
  await d1.settle();
  await d2.settle();
  await d1.coordinator.create(await routeContent("alice", 1, "Original"));
  await d1.settle();
  await d2.settle();
  d2.transport.holdSnapshots = true;
  await d1.coordinator.update(await routeContent("alice", 1, "Theirs"));
  await d1.settle();
  await d2.coordinator.update(await routeContent("alice", 1, "Mine"));
  await d2.settle();
  assert.equal(stateOf(d2)!.state, "conflict");
  await d2.coordinator.stop();

  const reloaded = makeDevice(cloud, { uid: "alice", storage });
  await reloaded.settle();
  const item = stateOf(reloaded)!;
  assert.equal(item.state, "conflict");
  assert.equal((item.conflict!.remote as { title: string }).title, "Theirs");
  assert.equal((item.value as { title: string }).title, "Mine");
  assert.deepEqual(
    await reloaded.coordinator.update(await routeContent("alice", 1, "More")),
    { ok: false, code: "in-conflict" },
  );
  assert.equal(title(cloud, 1), "Theirs");
  assert.deepEqual(
    contentOf(cloud.get("alice", "routes", routeId(1))!).id,
    routeId(1),
  );
});

test("resolving a conflict that does not exist, or discarding what is not there, is refused", async () => {
  const { d1 } = await twoDevices();
  assert.deepEqual(
    await d1.coordinator.resolveConflict(route(1), "keep-mine"),
    { ok: false, code: "not-found" },
  );
  assert.deepEqual(await d1.coordinator.discard(route(1)), {
    ok: false,
    code: "not-found",
  });
  assert.deepEqual(await d1.coordinator.retry(route(1)), {
    ok: false,
    code: "not-found",
  });
});
