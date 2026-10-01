import test from "node:test";
import assert from "node:assert/strict";
import {
  FakeCloud,
  makeDevice,
  placeContent,
  placeId,
  routeContent,
  routeId,
  type Device,
  type WriteBehavior,
} from "../support/cloud-sync-harness";
import { contentOf } from "../../src/cloud/sync/content";
import { validRouteRecord } from "../support/cloud-fixtures";

const route = (n: number) => ({
  collection: "routes" as const,
  id: routeId(n),
});
const place = (n: number) => ({
  collection: "places" as const,
  id: placeId(n),
});

/** What a device shows, reduced to what must agree between devices of one account. */
const view = (device: Device) => {
  const snapshot = device.coordinator.getSnapshot();
  return [...snapshot.routes, ...snapshot.places].map((item) => ({
    key: item.key,
    state: item.state,
    revision: item.acknowledgedRevision,
    value: item.value,
  }));
};

test("two independent coordinators on one account converge after save, rename, replacement, place edit and delete", async () => {
  const cloud = new FakeCloud();
  const d1 = makeDevice(cloud, { name: "d1", uid: "alice" });
  const d2 = makeDevice(cloud, { name: "d2", uid: "alice" });
  await d1.settle();
  await d2.settle();
  const agree = async (what: string) => {
    await d1.settle();
    await d2.settle();
    assert.deepEqual(view(d2), view(d1), what);
    assert.ok(
      view(d1).every((item) => item.state === "acknowledged"),
      `${what}: all acknowledged`,
    );
  };

  await d1.coordinator.create(await routeContent("alice", 1, "Saved on one"));
  await d1.coordinator.create(placeContent("alice", 1));
  await agree("save");
  assert.equal(view(d2).length, 2);

  await d1.coordinator.update(await routeContent("alice", 1, "Renamed on one"));
  await agree("rename");
  assert.equal(
    (view(d2)[0].value as { title: string }).title,
    "Renamed on one",
  );

  const loop = contentOf(
    await validRouteRecord("alice", {
      id: routeId(1),
      kind: "ExerciseLoop",
      engine: false,
    }),
  );
  await d1.coordinator.update(loop);
  await agree("route replacement");
  assert.equal((d2.items()[0].value as { kind: string }).kind, "ExerciseLoop");

  await d2.coordinator.update(placeContent("alice", 1, "Place edited on two"));
  await agree("place edit");
  assert.equal(
    (d1.items("places")[0].value as { label: string }).label,
    "Place edited on two",
  );

  await d2.coordinator.remove(route(1));
  await agree("delete");
  assert.deepEqual(d1.items().length, 0);
  assert.equal(d1.items("places").length, 1);
  assert.equal(cloud.ids("alice", "routes").length, 0);
  assert.deepEqual(cloud.violations, []);
});

test("a second account never sees or changes the first account's items, even under the same ids", async () => {
  const cloud = new FakeCloud();
  const alice = makeDevice(cloud, { name: "alice-device", uid: "alice" });
  const bob = makeDevice(cloud, { name: "bob-device", uid: "bob" });
  await alice.settle();
  await bob.settle();
  await alice.coordinator.create(await routeContent("alice", 1, "Alice route"));
  await alice.coordinator.create(placeContent("alice", 1, "Alice place"));
  await alice.settle();
  await bob.settle();
  assert.equal(bob.items().length, 0);
  assert.equal(bob.items("places").length, 0);

  // Bob cannot update or remove what is not in his library, and cannot claim alice as owner.
  assert.deepEqual(
    await bob.coordinator.update(await routeContent("alice", 1, "Hijack")),
    {
      ok: false,
      code: "owner-mismatch",
      detail: "owner-mismatch",
    },
  );
  assert.deepEqual(
    await bob.coordinator.update(await routeContent("bob", 1, "Hijack")),
    { ok: false, code: "not-found" },
  );
  assert.deepEqual(await bob.coordinator.remove(route(1)), {
    ok: false,
    code: "not-found",
  });

  // The same ids in his own library are his own records.
  await bob.coordinator.create(await routeContent("bob", 1, "Bob route"));
  await bob.settle();
  await alice.settle();
  assert.equal(
    (alice.items()[0].value as { title: string }).title,
    "Alice route",
  );
  assert.equal((bob.items()[0].value as { title: string }).title, "Bob route");
  await bob.coordinator.remove(route(1));
  await bob.settle();
  await alice.settle();
  assert.equal(alice.items().length, 1);
  assert.equal(alice.items("places").length, 1);
  assert.deepEqual(cloud.violations, []);
  assert.deepEqual(
    cloud.applied
      .filter(
        (entry) =>
          entry.outcome === "committed" && entry.key === `routes/${routeId(1)}`,
      )
      .map((entry) => entry.uid),
    ["alice", "bob"],
  );
});

test("the service refuses a request made under one account for another (the rules, as modelled), and the coordinator never makes one", async () => {
  const cloud = new FakeCloud();
  const result = cloud.commit("bob", "alice", {
    kind: "create",
    collection: "routes",
    id: routeId(1),
    content: await routeContent("alice", 1),
  });
  assert.deepEqual(result, { kind: "rejected", code: "permission-denied" });
  assert.equal(cloud.violations.length, 1);
  assert.equal(cloud.ids("alice", "routes").length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------
// a seeded random walk over two devices, an outside actor, outages, lost responses and deletes

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which situations the walks have actually reached (checked below, so a walk cannot quietly go easy). */
const seen = new Set<string>();

async function walk(seed: number, steps: number) {
  const random = prng(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)];
  const cloud = new FakeCloud();
  const devices = [
    makeDevice(cloud, { name: "d1", uid: "alice" }),
    makeDevice(cloud, { name: "d2", uid: "alice" }),
  ];
  let next = 1;
  const nameOf = (id: string) => Number(id.slice(3));
  const behaviors: WriteBehavior[] = [
    "ok",
    "ok",
    "ok",
    "ok",
    "unavailable",
    "lose-response",
    "drop-request",
    { reject: "permission-denied" },
  ];
  for (const device of devices) await device.settle();

  for (let step = 0; step < steps; step++) {
    const device = pick(devices);
    const items = device.coordinator.getSnapshot().routes;
    const roll = random();
    if (roll < 0.22 || items.length === 0) {
      await device.coordinator.create(
        await routeContent("alice", next++, `Route ${step}`),
      );
    } else if (roll < 0.4) {
      const item = pick(items);
      await device.coordinator.update(
        await routeContent("alice", nameOf(item.id), `Edit ${step}`),
      );
    } else if (roll < 0.52) {
      await device.coordinator.remove(route(nameOf(pick(items).id)));
    } else if (roll < 0.62) {
      device.transport.online = !device.transport.online;
      if (device.transport.online) {
        device.transport.reconnect();
        device.coordinator.retryNow();
      }
    } else if (roll < 0.74) {
      device.transport.next(pick(behaviors));
    } else if (roll < 0.82) {
      device.clock.advance(pick([500, 1500, 5000, 70_000]));
    } else if (roll < 0.9) {
      // an outside actor: another client's edit or hard delete straight at the cloud
      const ids = cloud.ids("alice", "routes");
      if (ids.length) {
        const id = pick(ids);
        if (random() < 0.5) cloud.erase("alice", "routes", id);
        else cloud.edit("alice", "routes", id, { title: `Outside ${step}` });
      }
    } else {
      const item = items.find(
        (candidate) =>
          candidate.state === "conflict" || candidate.state === "rejected",
      );
      if (item) {
        if (item.state === "conflict")
          await device.coordinator.resolveConflict(
            route(nameOf(item.id)),
            "keep-theirs",
          );
        else await device.coordinator.discard(route(nameOf(item.id)));
      }
    }
    for (let tick = 0; tick < 6; tick++)
      await new Promise((done) => setImmediate(done));
    for (const each of devices)
      for (const item of each.coordinator.getSnapshot().routes)
        seen.add(
          item.conflict
            ? `conflict:${item.conflict.code}`
            : item.rejectedCode
              ? "rejected"
              : `${item.state}:${item.change}`,
        );
  }

  // Everything comes back online and every leftover decision is made the conservative way.
  for (let round = 0; round < 4; round++) {
    for (const device of devices) {
      device.transport.online = true;
      device.transport.reconnect();
      device.coordinator.retryNow();
      device.clock.advance(70_000);
      await device.settle();
      for (const item of device.coordinator.getSnapshot().routes) {
        if (item.state === "conflict")
          await device.coordinator.resolveConflict(
            route(nameOf(item.id)),
            "keep-theirs",
          );
        else if (item.state === "rejected")
          await device.coordinator.discard(route(nameOf(item.id)));
      }
      await device.settle();
    }
  }
  for (const device of devices) await device.coordinator.whenIdle();
  return { cloud, devices };
}

test("random walk: no cross-account write, no duplicate create, no resurrection, no unsent work left, devices match the cloud", async () => {
  // TRAIL_WALK_SEEDS / TRAIL_WALK_STEPS widen the search locally; CI uses the defaults.
  const seeds = Number(process.env.TRAIL_WALK_SEEDS ?? 60);
  const steps = Number(process.env.TRAIL_WALK_STEPS ?? 45);
  for (let seed = 1; seed <= seeds; seed++) {
    const { cloud, devices } = await walk(seed, steps);
    const label = `seed ${seed}`;
    assert.deepEqual(cloud.violations, [], label);

    // A record is created in the cloud at most once, and never again after it was deleted (no explicit keep-mine here).
    const created = new Map<string, number>();
    const deleted = new Set<string>();
    for (const entry of cloud.applied) {
      if (entry.outcome === "committed" && entry.kind === "create") {
        created.set(entry.key, (created.get(entry.key) ?? 0) + 1);
        assert.ok(
          !deleted.has(entry.key),
          `${label}: ${entry.key} was re-created after a delete`,
        );
      }
      if (entry.outcome === "deleted") deleted.add(entry.key);
    }
    for (const [key, count] of created)
      assert.equal(count, 1, `${label}: ${key} created ${count} times`);

    // Nothing is left waiting, and every device shows exactly what the cloud holds.
    const truth = cloud.list("alice", "routes").map((record) => ({
      id: record.id,
      revision: record.revision,
      content: contentOf(record),
    }));
    for (const device of devices) {
      const snapshot = device.coordinator.getSnapshot();
      const stuck = (
        JSON.parse(
          device.storage.journals.get("alice") ?? '{"entries":[]}',
        ) as {
          entries: Array<Record<string, unknown>>;
        }
      ).entries.map((entry) =>
        JSON.stringify({
          id: entry.id,
          status: entry.status,
          want: (entry.want as { kind: string }).kind,
          base: entry.baseRevision,
          attempt: entry.attempt && {
            kind: (entry.attempt as { kind: string }).kind,
            maybe: (entry.attempt as { mayHaveApplied: boolean })
              .mayHaveApplied,
          },
          conflict: (entry.conflict as { code?: string } | undefined)?.code,
        }),
      );
      assert.equal(
        (await device.coordinator.unsentChanges("alice")).count,
        0,
        `${label}: ${device.name} has unsent work: ${stuck.join(" ")}`,
      );
      assert.equal(
        snapshot.counts.conflict +
          snapshot.counts.pending +
          snapshot.counts.retrying +
          snapshot.counts.rejected,
        0,
        label,
      );
      assert.deepEqual(
        snapshot.routes.map((item) => ({
          id: item.id,
          revision: item.acknowledgedRevision,
          content: item.value,
        })),
        truth,
        `${label}: ${device.name} differs from the cloud`,
      );
    }
  }
});

test("the random walks really reach the hard situations", () => {
  for (const wanted of [
    "conflict:edited-elsewhere",
    "conflict:deleted-elsewhere",
    "conflict:possibly-deleted",
    "conflict:already-exists",
    "rejected",
    "retrying:create",
    "retrying:update",
    "retrying:delete",
  ])
    assert.ok(
      seen.has(wanted),
      `never reached ${wanted}: ${[...seen].sort().join(", ")}`,
    );
});

test("random walk is deterministic for a seed", async () => {
  const run = async () => {
    const { cloud } = await walk(7, 40);
    return JSON.stringify(cloud.applied);
  };
  assert.equal(await run(), await run());
});

test("places and routes together: a mixed library stays separate by collection", async () => {
  const cloud = new FakeCloud();
  const device = makeDevice(cloud, { uid: "alice" });
  await device.coordinator.create(await routeContent("alice", 1));
  await device.coordinator.create(placeContent("alice", 1));
  await device.settle();
  await device.coordinator.remove(place(1));
  await device.settle();
  assert.equal(device.items().length, 1);
  assert.equal(device.items("places").length, 0);
  assert.deepEqual(cloud.ids("alice", "places"), []);
  assert.deepEqual(cloud.ids("alice", "routes"), [routeId(1)]);
});
