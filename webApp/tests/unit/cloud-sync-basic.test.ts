import test from "node:test";
import assert from "node:assert/strict";
import {
  FakeCloud,
  faultyStorage,
  makeDevice,
  placeContent,
  placeId,
  routeContent,
  routeId,
} from "../support/cloud-sync-harness";
import { validRouteRecord } from "../support/cloud-fixtures";
import { contentOf } from "../../src/cloud/sync/content";

const route = (n: number) => ({
  collection: "routes" as const,
  id: routeId(n),
});

test("a created route is pending until the cloud acknowledges it, then acknowledged with revision 1", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  device.transport.next("hold-response");
  const result = await device.coordinator.create(
    await routeContent("alice", 1),
  );
  assert.deepEqual(result, {
    ok: true,
    key: `routes/${routeId(1)}`,
    durable: true,
  });
  await device.settle();
  // The cloud already holds it, but this device has not heard back: the truthful state is still pending.
  assert.equal(cloud.ids("alice", "routes").length, 1);
  assert.equal(device.items()[0].state, "pending");
  assert.equal(device.items()[0].change, "create");
  assert.equal(device.items()[0].acknowledgedRevision, null);
  device.transport.held[0].release();
  await device.settle();
  const [item] = device.items();
  assert.equal(item.state, "acknowledged");
  assert.equal(item.change, "none");
  assert.equal(item.acknowledgedRevision, 1);
  assert.equal(device.coordinator.getSnapshot().counts.acknowledged, 1);
  assert.equal(device.coordinator.getSnapshot().counts.pending, 0);
  // Nothing unsent remains in the journal.
  assert.equal((await device.coordinator.unsentChanges("alice")).count, 0);
  assert.deepEqual(cloud.violations, []);
});

test("rename and route replacement are updates of the same record: same id, revision + 1, created time kept", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1, "First name"));
  await device.settle();
  const created = cloud.get("alice", "routes", routeId(1))!;
  await device.coordinator.update(await routeContent("alice", 1, "Renamed"));
  await device.settle();
  const renamed = cloud.get("alice", "routes", routeId(1))!;
  assert.equal(renamed.revision, 2);
  assert.equal(renamed.createdAt, created.createdAt);
  assert.equal((renamed as { title: string }).title, "Renamed");
  // A replacement: a different route under the same id (here the loop variant of the synthetic route).
  const loop = contentOf(
    await validRouteRecord("alice", {
      id: routeId(1),
      kind: "ExerciseLoop",
      engine: false,
    }),
  );
  await device.coordinator.update(loop);
  await device.settle();
  assert.equal(cloud.get("alice", "routes", routeId(1))!.revision, 3);
  assert.deepEqual(cloud.ids("alice", "routes"), [routeId(1)]);
  assert.equal(device.items()[0].state, "acknowledged");
  assert.equal(device.items()[0].acknowledgedRevision, 3);
});

test("a delete shows as deleting until acknowledged, then the record is gone and its id cannot be saved again", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  device.transport.next("hold-response");
  device.transport.holdSnapshots = true;
  await device.coordinator.remove(route(1));
  await device.settle();
  assert.equal(device.items()[0].change, "delete");
  assert.equal(device.items()[0].state, "pending");
  device.transport.held[0].release();
  await device.settle();
  assert.equal(device.items().length, 0);
  device.transport.flushSnapshots();
  await device.settle();
  assert.equal(device.items().length, 0);
  assert.equal(cloud.ids("alice", "routes").length, 0);
  // Ids are never reused: saving the same id again is refused, so a deleted record cannot silently come back.
  assert.deepEqual(
    await device.coordinator.create(await routeContent("alice", 1)),
    {
      ok: false,
      code: "deleted",
    },
  );
  assert.deepEqual(
    await device.coordinator.update(await routeContent("alice", 1)),
    {
      ok: false,
      code: "deleted",
    },
  );
});

test("places sync like routes", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(placeContent("alice", 1));
  await device.settle();
  await device.coordinator.update(placeContent("alice", 1, "Renamed place"));
  await device.settle();
  const [item] = device.items("places");
  assert.equal(item.state, "acknowledged");
  assert.equal(item.acknowledgedRevision, 2);
  assert.equal(
    (cloud.get("alice", "places", placeId(1)) as { label: string }).label,
    "Renamed place",
  );
});

test("a request to create the same record twice is idempotent; a different value for a used id is refused", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  device.transport.online = false;
  const content = await routeContent("alice", 1);
  const first = await device.coordinator.create(content);
  const second = await device.coordinator.create(content);
  assert.ok(first.ok && second.ok);
  assert.equal(device.items().length, 1);
  assert.deepEqual(
    await device.coordinator.create(
      await routeContent("alice", 1, "Other title"),
    ),
    {
      ok: false,
      code: "exists",
    },
  );
  device.transport.reconnect();
  device.coordinator.retryNow();
  await device.settle();
  assert.equal(
    cloud.applied.filter((entry) => entry.kind === "create").length,
    1,
  );
  // Creating something the cloud already holds is also refused.
  assert.deepEqual(
    await device.coordinator.create(await routeContent("alice", 1)),
    {
      ok: false,
      code: "exists",
    },
  );
});

test("an update or delete of a record the library does not know is refused, not invented", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  assert.deepEqual(
    await device.coordinator.update(await routeContent("alice", 9)),
    {
      ok: false,
      code: "not-found",
    },
  );
  assert.deepEqual(await device.coordinator.remove(route(9)), {
    ok: false,
    code: "not-found",
  });
  assert.equal(
    device.transport.calls.filter((call) => call.type === "write").length,
    0,
  );
});

test("content is validated before it is stored or sent: bad shape, someone else's owner, cloud bookkeeping, junk", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  const good = await routeContent("alice", 1);
  const cases: Array<[string, unknown, string, string]> = [
    [
      "another account's owner",
      await routeContent("bob", 1),
      "owner-mismatch",
      "owner-mismatch",
    ],
    [
      "a client-chosen revision",
      { ...good, revision: 5 },
      "invalid",
      "unknown-field",
    ],
    [
      "a client-chosen timestamp",
      { ...good, createdAt: "2026-10-01T12:00:00Z" },
      "invalid",
      "unknown-field",
    ],
    ["an unknown field", { ...good, notes: "x" }, "invalid", "unknown-field"],
    [
      "latitude out of range",
      {
        ...good,
        draft: {
          ...(good as { draft: object }).draft,
          start: { label: "x", latitude: 91, longitude: 0 },
        },
      },
      "invalid",
      "coordinate-out-of-range",
    ],
    ["a bad id", { ...good, id: "short" }, "invalid", "invalid-field"],
    [
      "a future version",
      { ...good, version: 2 },
      "invalid",
      "unsupported-version",
    ],
    ["not an object", "route", "invalid", "malformed"],
    ["an unknown schema", { ...good, schema: "other" }, "invalid", "malformed"],
    [
      "private local-review data",
      {
        ...good,
        dataset: {
          ...(good as { dataset: object }).dataset,
          kind: "local-review",
        },
      },
      "invalid",
      "dataset-not-allowed",
    ],
  ];
  for (const [name, content, code, detail] of cases) {
    const result = await device.coordinator.create(content);
    assert.deepEqual(result, { ok: false, code, detail }, name);
  }
  assert.equal(device.coordinator.getSnapshot().routes.length, 0);
  assert.equal(
    device.transport.calls.filter((call) => call.type === "write").length,
    0,
  );
  assert.equal((await device.coordinator.unsentChanges("alice")).count, 0);
});

test("an engine payload that disagrees with its record is refused when saving", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  const withEngine = contentOf(
    await validRouteRecord("alice", { id: routeId(1), engine: true }),
  );
  const other = contentOf(
    await validRouteRecord("alice", {
      id: routeId(1),
      kind: "ExerciseLoop",
      engine: true,
    }),
  );
  const mismatched = {
    ...withEngine,
    engine: (other as { engine?: string }).engine,
  };
  const result = await device.coordinator.create(mismatched);
  assert.equal(result.ok, false);
  assert.equal(device.coordinator.getSnapshot().routes.length, 0);
  assert.ok((await device.coordinator.create(withEngine)).ok);
});

test("with nobody signed in nothing can be saved and nothing is shown", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud);
  await device.settle();
  assert.deepEqual(
    await device.coordinator.create(await routeContent("alice", 1)),
    {
      ok: false,
      code: "signed-out",
    },
  );
  const snapshot = device.coordinator.getSnapshot();
  assert.equal(snapshot.phase, "signed-out");
  assert.equal(snapshot.account, null);
  assert.equal(snapshot.routes.length, 0);
});

test("a failed local save is reported as not durable, and a later successful save restores it", async () => {
  const cloud = new FakeCloud();
  const storage = faultyStorage();
  const device = makeDevice(cloud, { uid: "alice", storage });
  await device.settle();
  storage.faults.failSave = true;
  device.transport.online = false;
  const result = await device.coordinator.create(
    await routeContent("alice", 1),
  );
  assert.deepEqual(result, {
    ok: true,
    key: `routes/${routeId(1)}`,
    durable: false,
  });
  assert.equal(device.coordinator.getSnapshot().durable, false);
  storage.faults.failSave = false;
  await device.coordinator.create(await routeContent("alice", 2));
  assert.equal(device.coordinator.getSnapshot().durable, true);
});

test("a no-op edit sends nothing and the item stays acknowledged", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  const writes = device.transport.writesFor("alice").length;
  const result = await device.coordinator.update(
    await routeContent("alice", 1),
  );
  assert.ok(result.ok);
  await device.settle();
  assert.equal(device.transport.writesFor("alice").length, writes);
  assert.equal(device.items()[0].state, "acknowledged");
});

test("the snapshot is stable between changes and notifies subscribers when something changes", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.settle();
  let calls = 0;
  const stop = device.coordinator.subscribe(() => calls++);
  const before = device.coordinator.getSnapshot();
  assert.equal(device.coordinator.getSnapshot(), before);
  await device.coordinator.create(await routeContent("alice", 1));
  await device.settle();
  assert.ok(calls > 0);
  assert.notEqual(device.coordinator.getSnapshot(), before);
  assert.ok(device.coordinator.getSnapshot().version > before.version);
  stop();
});
