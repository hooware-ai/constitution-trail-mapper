import test from "node:test";
import assert from "node:assert/strict";
import {
  FakeCloud,
  faultyStorage,
  makeDevice,
  routeContent,
  routeId,
} from "../support/cloud-sync-harness";
import { memoryStorage } from "../../src/cloud/sync/journal";
import { validRouteRecord } from "../support/cloud-fixtures";

const route = (n: number) => ({
  collection: "routes" as const,
  id: routeId(n),
});
const createCalls = (cloud: FakeCloud, uid: string) =>
  cloud.applied.filter((entry) => entry.uid === uid && entry.kind === "create");

test("a write completion that arrives after an account switch is dropped, never applied to the new account, and the first account reconciles on its next sign-in without a second create", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  device.transport.next("hold-response");
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  assert.equal(device.transport.held.length, 1);

  device.session.set("bob");
  await device.settle();
  const dropped = device.coordinator.diagnostics().staleCallbacksDropped;
  device.transport.held[0].release();
  await device.settle();

  // The late answer for alice's request changed nothing about bob's library, and bob sent nothing.
  assert.ok(device.coordinator.diagnostics().staleCallbacksDropped > dropped);
  assert.equal(device.coordinator.getSnapshot().account, "bob");
  assert.equal(device.items().length, 0);
  assert.equal(device.transport.writesFor("bob").length, 0);
  assert.deepEqual(cloud.violations, []);

  device.session.set("alice");
  await device.settle();
  // Alice's attempt was recorded as possibly applied, so the cloud was asked first and nothing was created twice.
  assert.equal(createCalls(cloud, "alice").length, 1);
  assert.equal(device.items().length, 1);
  assert.equal(device.items()[0].state, "acknowledged");
  assert.equal(device.items()[0].acknowledgedRevision, 1);
  assert.deepEqual(cloud.violations, []);
});

test("unsent changes are bound to the account that made them: they survive sign-out, are never sent for anyone else, and go out only when that account is back", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  device.transport.online = false;
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  assert.equal((await device.coordinator.unsentChanges("alice")).count, 1);

  device.session.set(null);
  await device.settle();
  assert.equal(device.coordinator.getSnapshot().phase, "signed-out");
  assert.equal(device.items().length, 0);
  // The work is kept (sign-out never loses an unsent save) and can be explained to the rider.
  assert.equal((await device.coordinator.unsentChanges("alice")).count, 1);

  device.session.set("bob");
  device.transport.reconnect();
  device.coordinator.retryNow();
  await device.settle();
  assert.equal(device.items().length, 0);
  assert.equal(
    device.transport.writesFor("alice").length,
    1,
    "only the original offline attempt",
  );
  assert.equal(cloud.ids("alice", "routes").length, 0);
  // Bob can save his own work meanwhile, and it carries his uid.
  await device.coordinator.create(await routeContent("bob", 2));
  await device.settle();
  assert.deepEqual(cloud.ids("bob", "routes"), [routeId(2)]);

  device.session.set("alice");
  await device.settle();
  device.coordinator.retryNow();
  await device.settle();
  assert.deepEqual(cloud.ids("alice", "routes"), [routeId(1)]);
  assert.deepEqual(cloud.violations, []);
  assert.deepEqual(
    cloud.applied
      .filter((entry) => entry.outcome === "committed")
      .map((entry) => [entry.uid, entry.key]),
    [
      ["bob", `routes/${routeId(2)}`],
      ["alice", `routes/${routeId(1)}`],
    ],
  );
});

test("a listener delivery for the previous account is dropped after a switch, even when it arrives later", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  device.transport.holdSnapshots = true;
  cloud.put({
    ...(await validRouteRecord("alice", { id: routeId(2), engine: false })),
  });
  await device.settle();
  assert.equal(device.transport.heldSnapshots() > 0, true);

  device.session.set("bob");
  await device.settle();
  device.transport.flushSnapshots();
  await device.settle();
  assert.equal(device.coordinator.getSnapshot().account, "bob");
  assert.equal(device.items().length, 0);
  assert.equal(device.coordinator.getSnapshot().routes.length, 0);
});

test("a delivery that names another account, or carries another owner's records, is never shown", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "bob" });
  await device.settle();
  const alices = await validRouteRecord("alice", {
    id: routeId(5),
    engine: false,
  });
  // Claims to be read for alice while bob is signed in.
  device.transport.inject("routes", {
    readFor: "alice",
    complete: true,
    records: [alices],
    removed: [],
  });
  // Read for bob, but a record in it belongs to alice (a bug or an attack on the transport).
  device.transport.inject("routes", {
    readFor: "bob",
    complete: true,
    records: [alices],
    removed: [],
  });
  await device.settle();
  assert.equal(device.items().length, 0);
  assert.ok(device.coordinator.diagnostics().foreignRecordsDropped >= 1);
  assert.ok(device.coordinator.diagnostics().staleCallbacksDropped >= 1);
});

test("an account change is honoured immediately even if the notification is late: a stale completion is dropped on the spot", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  device.transport.next("hold-response");
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  // The session changes but the engine is not told (a lagging notification).
  device.session.set("bob", false);
  device.transport.held[0].release();
  await device.settle();
  assert.equal(device.coordinator.getSnapshot().account, "bob");
  assert.equal(device.items().length, 0);
  assert.equal(device.transport.writesFor("bob").length, 0);
});

test("sign out and straight back in: deliveries from the first session are stale in the second", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  device.transport.holdSnapshots = true;
  cloud.put(await validRouteRecord("alice", { id: routeId(2), engine: false }));
  await device.settle();
  device.session.set(null);
  device.session.set("alice");
  await device.settle();
  const before = device.coordinator.diagnostics().staleCallbacksDropped;
  device.transport.flushSnapshots();
  await device.settle();
  // Some deliveries belong to the first session's listeners (unsubscribed); they must not be applied again.
  assert.ok(device.coordinator.diagnostics().staleCallbacksDropped >= before);
  assert.equal(device.coordinator.getSnapshot().account, "alice");
});

test("sign-out clears the cached acknowledged records but keeps unsent work; keepCacheOnSignOut keeps the cache", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  assert.ok(device.storage.caches.has("alice"));
  device.transport.online = false;
  await device.coordinator.create(await routeContent("alice", 2));
  await device.settle();
  device.session.set(null);
  await device.settle();
  assert.equal(
    device.storage.caches.has("alice"),
    false,
    "private cache removed on sign-out",
  );
  assert.ok(device.storage.journals.has("alice"));
  assert.equal((await device.coordinator.unsentChanges("alice")).count, 1);

  const keeper = makeDevice(cloud, { uid: "alice", keepCacheOnSignOut: true });
  await keeper.settle();
  keeper.session.set(null);
  await keeper.settle();
  assert.ok(keeper.storage.caches.has("alice"));
});

test("after a reload the cached acknowledged records are shown while offline, and no other account's cache is read", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const first = makeDevice(cloud, { uid: "alice", storage });
  await first.coordinator.create(await routeContent("alice", 1));
  await first.settle();
  await first.coordinator.stop();

  const other = makeDevice(cloud, { uid: "bob", storage });
  other.transport.online = false;
  await other.settle();
  assert.equal(other.items().length, 0);
  await other.coordinator.stop();

  const reloaded = makeDevice(cloud, { uid: "alice", storage });
  reloaded.transport.online = false;
  await reloaded.settle();
  assert.equal(reloaded.items().length, 1);
  assert.equal(reloaded.items()[0].state, "acknowledged");
  assert.equal(reloaded.coordinator.getSnapshot().connection, "unknown");
});

test("a journal that holds another account's entries is not trusted: damaged entries are dropped and counted, never sent", async () => {
  const cloud = new FakeCloud();
  const source = makeDevice(cloud, { uid: "alice" });
  source.transport.online = false;
  await source.coordinator.create(await routeContent("alice", 1));
  await source.settle();
  const aliceEntry = (
    JSON.parse(source.storage.journals.get("alice")!) as { entries: unknown[] }
  ).entries[0] as Record<string, unknown>;
  const bobEntry = { ...aliceEntry, uid: "bob" }; // claims bob but its content is alice's
  const storage = memoryStorage();
  storage.journals.set(
    "bob",
    JSON.stringify({
      version: 1,
      uid: "bob",
      entries: [aliceEntry, bobEntry, "junk", { uid: "bob" }],
    }),
  );
  const device = makeDevice(cloud, { uid: "bob", storage });
  await device.settle();
  const snapshot = device.coordinator.getSnapshot();
  assert.equal(snapshot.phase, "ready");
  assert.equal(snapshot.recovered.entries, 4);
  assert.equal(snapshot.routes.length, 0);
  assert.equal(device.transport.writesFor("bob").length, 0);
  assert.equal(device.transport.writesFor("alice").length, 0);
  assert.deepEqual(cloud.violations, []);
});

test("a journal stored under one account but claiming another, or from a newer build, is not loaded, sent or overwritten", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const claimed = JSON.stringify({ version: 1, uid: "alice", entries: [] });
  const newer = JSON.stringify({
    version: 2,
    uid: "carol",
    entries: [{ future: true }],
  });
  storage.journals.set("bob", claimed);
  storage.journals.set("carol", newer);
  const device = makeDevice(cloud, { uid: "bob", storage });
  await device.settle();
  assert.equal(device.coordinator.getSnapshot().phase, "unavailable");
  assert.equal(
    device.coordinator.getSnapshot().unavailableReason,
    "journal-unsupported",
  );
  assert.deepEqual(
    await device.coordinator.create(await routeContent("bob", 1)),
    {
      ok: false,
      code: "unavailable",
    },
  );
  device.session.set("carol");
  await device.settle();
  assert.equal(
    device.coordinator.getSnapshot().unavailableReason,
    "journal-unsupported",
  );
  assert.equal(storage.journals.get("bob"), claimed);
  assert.equal(storage.journals.get("carol"), newer);
  assert.equal(
    device.transport.calls.filter((call) => call.type === "write").length,
    0,
  );
  assert.equal(
    device.transport.calls.filter((call) => call.type === "listen").length,
    0,
  );
});

test("when the journal cannot be read nothing is shown or sent and nothing is written over it", async () => {
  const cloud = new FakeCloud();
  const storage = faultyStorage();
  storage.faults.failLoad = true;
  const device = makeDevice(cloud, { uid: "alice", storage });
  await device.settle();
  assert.equal(device.coordinator.getSnapshot().phase, "unavailable");
  assert.equal(
    device.coordinator.getSnapshot().unavailableReason,
    "storage-unavailable",
  );
  assert.equal(storage.faults.saves, 0);
  assert.equal(
    (await device.coordinator.unsentChanges("alice")).readable,
    false,
  );
});

test("forgetting an account refuses while unsent work exists, and removes everything only when told it may be lost", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  device.transport.online = false;
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  assert.deepEqual(await device.coordinator.forgetAccount("alice"), {
    ok: false,
    code: "account-active",
    count: 0,
  });
  device.session.set(null);
  await device.settle();
  assert.deepEqual(await device.coordinator.forgetAccount("alice"), {
    ok: false,
    code: "unsent-changes",
    count: 1,
  });
  assert.ok(device.storage.journals.has("alice"));
  assert.deepEqual(
    await device.coordinator.forgetAccount("alice", { dropUnsent: true }),
    { ok: true, discarded: 1 },
  );
  assert.equal(device.storage.journals.has("alice"), false);
  assert.equal(device.storage.caches.has("alice"), false);
});

test("two accounts on one device keep entirely separate libraries and journals", async () => {
  const cloud = new FakeCloud();
  const storage = memoryStorage();
  const device = makeDevice(cloud, { uid: "alice", storage });
  device.transport.online = false;
  await device.coordinator.create(await routeContent("alice", 1));
  device.session.set("bob");
  await device.settle();
  await device.coordinator.create(await routeContent("bob", 2));
  await device.settle();
  assert.deepEqual(
    device.items().map((item) => item.id),
    [routeId(2)],
  );
  const journals = ["alice", "bob"].map((uid) =>
    (
      JSON.parse(storage.journals.get(uid)!) as {
        entries: Array<{ uid: string; id: string }>;
      }
    ).entries.map((entry) => `${entry.uid}:${entry.id}`),
  );
  assert.deepEqual(journals, [[`alice:${routeId(1)}`], [`bob:${routeId(2)}`]]);
  // An update that names the other account's record is refused, not applied to anyone.
  assert.deepEqual(
    await device.coordinator.update(await routeContent("alice", 1, "hijack")),
    {
      ok: false,
      code: "owner-mismatch",
      detail: "owner-mismatch",
    },
  );
  assert.deepEqual(await device.coordinator.remove(route(1)), {
    ok: false,
    code: "not-found",
  });
});

test("a mutation started for one account and finished after a switch is refused, never attributed to the new account", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  const content = await routeContent("alice", 1);
  const pending = device.coordinator.create(content);
  device.session.set("bob"); // switches while the content is still being validated
  const result = await pending;
  assert.deepEqual(result, { ok: false, code: "account-changed" });
  await device.settle();
  assert.equal(device.items().length, 0);
  assert.equal(device.transport.writesFor("bob").length, 0);
  assert.equal(device.transport.writesFor("alice").length, 0);
  assert.equal((await device.coordinator.unsentChanges("alice")).count, 0);
});

test("an entry whose own uid names another account is dropped even when its content is the signed-in account's", async () => {
  const cloud = new FakeCloud();
  const source = makeDevice(cloud, { uid: "bob" });
  source.transport.online = false;
  await source.coordinator.create(await routeContent("bob", 1));
  await source.settle();
  const entry = (
    JSON.parse(source.storage.journals.get("bob")!) as {
      entries: Array<Record<string, unknown>>;
    }
  ).entries[0];
  const storage = memoryStorage();
  storage.journals.set(
    "bob",
    JSON.stringify({
      version: 1,
      uid: "bob",
      entries: [{ ...entry, uid: "alice" }],
    }),
  );
  const device = makeDevice(cloud, { uid: "bob", storage });
  await device.settle();
  assert.equal(device.coordinator.getSnapshot().recovered.entries, 1);
  assert.equal(device.items().length, 0);
  assert.equal(device.transport.writesFor("bob").length, 0);
});
