import test from "node:test";
import assert from "node:assert/strict";
import {
  FakeCloud,
  makeDevice,
  routeContent,
  routeId,
} from "../support/cloud-sync-harness";
import { memoryStorage } from "../../src/cloud/sync/journal";

const route = (n: number) => ({
  collection: "routes" as const,
  id: routeId(n),
});
const creates = (cloud: FakeCloud) =>
  cloud.applied.filter(
    (entry) => entry.kind === "create" && entry.outcome === "committed",
  );
const title = (cloud: FakeCloud, n: number) =>
  (cloud.get("alice", "routes", routeId(n)) as { title: string } | null)?.title;

test("offline create, reload, reconnect: the record is sent once with its original id", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const first = makeDevice(cloud, { uid: "alice", storage });
  first.transport.online = false;
  assert.ok(
    (
      await first.coordinator.create(
        await routeContent("alice", 1, "Offline route"),
      )
    ).ok,
  );
  await first.settle();
  assert.equal(first.items()[0].state, "retrying");
  assert.equal(first.coordinator.getSnapshot().connection, "offline");
  await first.coordinator.stop(); // the page is closed before the cloud was ever reached

  const second = makeDevice(cloud, { uid: "alice", storage });
  await second.settle();
  assert.equal(creates(cloud).length, 1);
  assert.equal(title(cloud, 1), "Offline route");
  assert.deepEqual(cloud.ids("alice", "routes"), [routeId(1)]);
  assert.equal(second.items()[0].state, "acknowledged");
  assert.equal((await second.coordinator.unsentChanges("alice")).count, 0);
});

test("offline update and offline delete survive a reload and apply at the revision they were based on", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const first = makeDevice(cloud, { uid: "alice", storage });
  await first.coordinator.create(await routeContent("alice", 1, "One"));
  await first.coordinator.create(await routeContent("alice", 2, "Two"));
  await first.settle();
  first.transport.online = false;
  await first.coordinator.update(
    await routeContent("alice", 1, "One edited offline"),
  );
  await first.coordinator.remove(route(2));
  await first.settle();
  assert.deepEqual(
    first.items().map((item) => [item.change, item.state]),
    [
      ["update", "retrying"],
      ["delete", "retrying"],
    ],
  );
  await first.coordinator.stop();

  const second = makeDevice(cloud, { uid: "alice", storage });
  second.transport.online = false;
  await second.settle();
  // Shown from the cache and journal while still offline: never as saved, and the retry that just failed is visible.
  assert.deepEqual(
    second.items().map((item) => [item.change, item.state]),
    [
      ["update", "retrying"],
      ["delete", "retrying"],
    ],
  );
  second.transport.reconnect();
  second.coordinator.retryNow();
  await second.settle();
  assert.equal(title(cloud, 1), "One edited offline");
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 2);
  assert.equal(cloud.get("alice", "routes", routeId(2)), null);
  assert.deepEqual(
    second.items().map((item) => [item.id, item.state]),
    [[routeId(1), "acknowledged"]],
  );
});

test("offline edits to one unsent record collapse into one request; a record created and removed offline is never sent", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  device.transport.online = false;
  await device.coordinator.create(await routeContent("alice", 1, "Draft one"));
  await device.coordinator.update(await routeContent("alice", 1, "Final one"));
  await device.coordinator.create(
    await routeContent("alice", 2, "Short lived"),
  );
  await device.coordinator.remove(route(2));
  await device.settle();
  assert.deepEqual(
    device.items().map((item) => item.id),
    [routeId(1)],
  );
  device.transport.reconnect();
  device.coordinator.retryNow();
  await device.settle();
  assert.equal(creates(cloud).length, 1);
  assert.equal(title(cloud, 1), "Final one");
  assert.equal(cloud.get("alice", "routes", routeId(2)), null);
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 1);
  assert.equal(
    cloud.applied.filter((entry) => entry.key.endsWith(routeId(2))).length,
    0,
  );
});

test("a transient failure is retried with a growing delay, and each failure is shown as retrying, not as saved", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  device.transport.online = false;
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  const writes = () => device.transport.writesFor("alice").length;
  assert.equal(writes(), 1);
  for (const delay of [1000, 2000, 4000]) {
    device.clock.advance(delay - 1);
    await device.settle();
    const before = writes();
    device.clock.advance(1);
    await device.settle();
    assert.equal(writes(), before + 1, `retry after ${delay} ms`);
    assert.equal(device.items()[0].state, "retrying");
  }
  device.transport.reconnect();
  device.clock.advance(8000);
  await device.settle();
  assert.equal(device.items()[0].state, "acknowledged");
  assert.equal(device.coordinator.getSnapshot().connection, "online");
  assert.equal(creates(cloud).length, 1);
});

test("an update whose answer was lost is retried safely: no conflict, no double revision", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1, "Original"));
  await device.settle();
  device.transport.next("lose-response");
  await device.coordinator.update(await routeContent("alice", 1, "Renamed"));
  await device.settle();
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 2); // it did apply
  assert.equal(device.items()[0].state, "retrying"); // but this device cannot know that
  device.clock.advance(1000);
  await device.settle();
  assert.equal(device.items()[0].state, "acknowledged");
  assert.equal(device.items()[0].acknowledgedRevision, 2);
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 2);
  assert.equal(device.coordinator.getSnapshot().counts.conflict, 0);
});

test("a request that never arrived but was reported unknown is applied once on retry", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1, "Original"));
  await device.settle();
  device.transport.next("drop-request");
  await device.coordinator.update(await routeContent("alice", 1, "Renamed"));
  await device.settle();
  assert.equal(title(cloud, 1), "Original");
  device.clock.advance(1000);
  await device.settle();
  assert.equal(title(cloud, 1), "Renamed");
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 2);
  assert.equal(device.items()[0].state, "acknowledged");
});

test("a second edit made while the first was of unknown outcome still lands exactly once on top of it", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1, "Original"));
  await device.settle();
  device.transport.next("lose-response");
  await device.coordinator.update(await routeContent("alice", 1, "First edit"));
  await device.settle();
  await device.coordinator.update(
    await routeContent("alice", 1, "Second edit"),
  );
  device.clock.advance(1000);
  await device.settle();
  const record = cloud.get("alice", "routes", routeId(1))!;
  assert.equal(record.revision, 3);
  assert.equal(title(cloud, 1), "Second edit");
  assert.equal(device.coordinator.getSnapshot().counts.conflict, 0);
  assert.equal(device.items()[0].state, "acknowledged");
});

test("a create whose answer was lost, then a reload: the cloud is asked first and the record is not created twice", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const first = makeDevice(cloud, { uid: "alice", storage });
  await first.settle();
  first.transport.next("lose-response");
  await first.coordinator.create(await routeContent("alice", 1));
  await first.settle();
  assert.equal(creates(cloud).length, 1);
  assert.equal(first.items()[0].state, "retrying");
  await first.coordinator.stop();

  const second = makeDevice(cloud, { uid: "alice", storage });
  await second.settle();
  assert.equal(creates(cloud).length, 1, "no second create");
  assert.equal(
    second.transport.writesFor("alice").length,
    0,
    "found by reading, so nothing was sent",
  );
  assert.equal(second.items()[0].state, "acknowledged");
  assert.equal(second.items()[0].acknowledgedRevision, 1);
});

test("completions that arrive out of order settle each record correctly", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  device.transport.next("hold-response", "hold-response", "hold-response");
  for (const n of [1, 2, 3])
    await device.coordinator.create(await routeContent("alice", n));
  await device.settle();
  assert.equal(device.transport.held.length, 3);
  assert.ok(device.items().every((item) => item.state === "pending"));
  const order = device.transport.held.map((held) => held);
  order[2].release();
  await device.settle();
  assert.deepEqual(
    device.items().map((item) => item.state),
    ["pending", "pending", "acknowledged"],
  );
  order[0].release();
  order[1].release();
  await device.settle();
  assert.ok(device.items().every((item) => item.state === "acknowledged"));
  assert.equal(creates(cloud).length, 3);
});

test("an edit made while the create is in flight is sent after it, based on the revision the create produced", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  device.transport.next("hold-response");
  await device.coordinator.create(await routeContent("alice", 1, "Before"));
  await device.settle();
  await device.coordinator.update(await routeContent("alice", 1, "After"));
  device.transport.held[0].release();
  await device.settle();
  assert.equal(title(cloud, 1), "After");
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 2);
  assert.equal(device.items()[0].state, "acknowledged");
  assert.equal(device.transport.writesFor("alice").length, 2);
});

test("out-of-order and duplicate snapshots never move a record backwards", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1, "Original"));
  await device.settle();
  const older = cloud.snapshot("alice", "routes");
  await device.coordinator.update(await routeContent("alice", 1, "Newer"));
  await device.settle();
  const newer = cloud.snapshot("alice", "routes");
  device.transport.inject("routes", newer);
  device.transport.inject("routes", older);
  device.transport.inject("routes", older);
  device.transport.inject("routes", newer);
  await device.settle();
  assert.equal(device.items()[0].acknowledgedRevision, 2);
  assert.equal((device.items()[0].value as { title: string }).title, "Newer");
  assert.ok(device.coordinator.diagnostics().staleRecordsIgnored >= 2);
  assert.equal(device.items().length, 1);
});

test("a refused change is kept as rejected, not retried on its own, and can be retried or discarded by the rider", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  device.transport.next({ reject: "permission-denied" });
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  assert.equal(device.items()[0].state, "rejected");
  assert.equal(device.items()[0].rejectedCode, "permission-denied");
  const writes = device.transport.writesFor("alice").length;
  device.clock.advance(120_000);
  await device.settle();
  assert.equal(
    device.transport.writesFor("alice").length,
    writes,
    "never retried automatically",
  );
  assert.equal((await device.coordinator.unsentChanges("alice")).count, 1);
  assert.ok((await device.coordinator.retry(route(1))).ok);
  await device.settle();
  assert.equal(device.items()[0].state, "acknowledged");

  device.transport.next({ reject: "permission-denied" });
  await device.coordinator.update(
    await routeContent("alice", 1, "Refused edit"),
  );
  await device.settle();
  assert.equal(device.items()[0].state, "rejected");
  assert.ok((await device.coordinator.discard(route(1))).ok);
  await device.settle();
  assert.equal(device.items()[0].state, "acknowledged");
  assert.equal(title(cloud, 1), "Synthetic route 1");
});

test("a listener that fails is re-attached later and catches up", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  assert.equal(device.transport.listening("alice"), 2);
  device.transport.online = false;
  device.transport.failListeners("unavailable");
  await device.settle();
  assert.equal(device.transport.listening("alice"), 0);
  assert.equal(device.coordinator.getSnapshot().connection, "offline");
  cloud.put({
    ...(await (
      await import("../support/cloud-fixtures")
    ).validRouteRecord("alice", { id: routeId(7), engine: false })),
  });
  device.transport.online = true;
  device.clock.advance(1000);
  await device.settle();
  assert.equal(device.transport.listening("alice"), 2);
  assert.deepEqual(
    device.items().map((item) => item.id),
    [routeId(7)],
  );
  assert.equal(device.coordinator.getSnapshot().connection, "online");
});

test("a manual refresh reads both collections, and a listener delivery that arrived meanwhile wins", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  cloud.put(
    await (
      await import("../support/cloud-fixtures")
    ).validRouteRecord("alice", { id: routeId(4), engine: false }),
  );
  device.transport.holdSnapshots = true;
  await device.coordinator.refresh();
  await device.settle();
  assert.deepEqual(
    device.items().map((item) => item.id),
    [routeId(4)],
  );
  assert.ok(
    device.transport.calls.some(
      (call) => call.type === "list" && call.detail === "places",
    ),
  );
  device.transport.online = false;
  await device.coordinator.refresh();
  assert.equal(device.coordinator.getSnapshot().connection, "offline");
});

test("write-ahead: by the time a request is sent, the journal on disk already says it may have applied", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const device = makeDevice(cloud, { uid: "alice", storage });
  await device.settle();
  const onDisk: unknown[] = [];
  device.transport.beforeWrite = () => {
    const journal = JSON.parse(
      storage.journals.get("alice") ?? '{"entries":[]}',
    );
    onDisk.push(
      journal.entries.map(
        (entry: {
          id: string;
          attempt: { mayHaveApplied: boolean; kind: string } | null;
        }) => [entry.id, entry.attempt?.kind, entry.attempt?.mayHaveApplied],
      ),
    );
  };
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  await device.coordinator.update(await routeContent("alice", 1, "Edited"));
  await device.settle();
  await device.coordinator.remove(route(1));
  await device.settle();
  assert.deepEqual(onDisk, [
    [[routeId(1), "create", true]],
    [[routeId(1), "update", true]],
    [[routeId(1), "delete", true]],
  ]);
});
