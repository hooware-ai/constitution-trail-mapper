// The saved-library coordinator against the LOCAL Firestore emulator and the committed rules (demo project only, no
// account, no credential, no network project). It checks that the transport contract the coordinator relies on holds on
// the real rules: conditional create/update/delete through transactions, real listeners between two independent
// coordinators of one account, and the account isolation the rules provide. Run with `npm run test:rules`.
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { SavedLibraryCoordinator } from "../../src/cloud/sync/coordinator";
import { memoryStorage } from "../../src/cloud/sync/journal";
import type {
  LibraryTransport,
  WriteRequest,
  WriteResult,
} from "../../src/cloud/sync/types";
import {
  FakeSession,
  ManualClock,
  routeContent,
  routeId,
} from "../support/cloud-sync-harness";
import { validRouteRecord } from "../support/cloud-fixtures";
import { firestoreTransport } from "./firestore-transport";
import {
  as,
  assertFails,
  assertSucceeds,
  createEnvironment,
  routeDocument,
} from "./support";

let env: RulesTestEnvironment;
before(async () => {
  env = await createEnvironment();
});
after(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
});

const route = (n: number) => ({
  collection: "routes" as const,
  id: routeId(n),
});
const pathOf = (uid: string, n: number) => `users/${uid}/routes/${routeId(n)}`;

async function until(
  check: () => boolean | Promise<boolean>,
  what: string,
  ms = 10_000,
) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for: ${what}`);
}

/** Routes each request to a connection signed in as the request's own account, and lets a test cut or lose the reply. */
function gateway() {
  const connections = new Map<string, ReturnType<typeof firestoreTransport>>();
  const connection = (uid: string) => {
    let held = connections.get(uid);
    if (!held) {
      held = firestoreTransport(as(env, uid));
      connections.set(uid, held);
    }
    return held;
  };
  const control = { offline: false, loseNextWrites: 0 };
  const transport: LibraryTransport = {
    async write(uid: string, request: WriteRequest): Promise<WriteResult> {
      if (control.offline) return { kind: "unavailable" };
      const result = await connection(uid).write(uid, request);
      if (control.loseNextWrites > 0) {
        control.loseNextWrites--;
        return { kind: "unknown" };
      }
      return result;
    },
    async read(uid, collection, id) {
      return control.offline
        ? { kind: "unavailable" }
        : connection(uid).read(uid, collection, id);
    },
    async list(uid, request) {
      return control.offline
        ? { kind: "unavailable" }
        : connection(uid).list(uid, request);
    },
    listen: (uid, collection, handlers) =>
      connection(uid).listen(uid, collection, handlers),
  };
  return {
    control,
    transport,
    requests: () => [...connections.values()].flatMap((held) => held.requests),
    connection,
  };
}

function device(uid: string | null, name: string) {
  const session = new FakeSession(uid);
  const link = gateway();
  const clock = new ManualClock();
  let counter = 0;
  const coordinator = new SavedLibraryCoordinator({
    session,
    transport: link.transport,
    storage: memoryStorage(),
    now: clock.now,
    schedule: clock.schedule,
    randomId: () => `${name}-${++counter}`,
  });
  coordinator.start();
  const items = () => coordinator.getSnapshot().routes;
  return { session, link, clock, coordinator, items, name };
}
type Device = ReturnType<typeof device>;
const titleOf = (item: { value: unknown } | undefined) =>
  (item?.value as { title?: string } | undefined)?.title;

test("two independent coordinators converge through real listeners on the real rules, with server timestamps and revisions", async () => {
  const d1 = device("alice", "d1");
  const d2 = device("alice", "d2");
  await d1.coordinator.create(await routeContent("alice", 1, "Saved on one"));
  await until(
    () =>
      d1.items()[0]?.state === "acknowledged" &&
      d2.items()[0]?.state === "acknowledged",
    "create to reach both",
  );
  const created = (
    await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))
  ).data()!;
  assert.equal(created.revision, 1);
  assert.deepEqual(
    created.createdAt,
    created.updatedAt,
    "created and updated are the same server instant",
  );

  await d1.coordinator.update(await routeContent("alice", 1, "Renamed on one"));
  await until(
    () =>
      titleOf(d2.items()[0]) === "Renamed on one" &&
      d2.items()[0].state === "acknowledged",
    "rename to reach device two",
  );
  const renamed = (
    await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))
  ).data()!;
  assert.equal(renamed.revision, 2);
  assert.deepEqual(renamed.createdAt, created.createdAt);
  assert.ok(renamed.updatedAt.toMillis() >= created.updatedAt.toMillis());
  assert.equal(d2.items()[0].acknowledgedRevision, 2);

  await d1.coordinator.remove(route(1));
  await until(
    () => d1.items().length === 0 && d2.items().length === 0,
    "delete to reach both",
  );
  assert.equal(
    (await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))).exists(),
    false,
  );
  await d1.coordinator.stop();
  await d2.coordinator.stop();
});

test("a stale edit is refused by the real preconditions and becomes a conflict; nothing is overwritten", async () => {
  const d1 = device("alice", "d1");
  const d2 = device("alice", "d2");
  await d1.coordinator.create(await routeContent("alice", 1, "Original"));
  await until(
    () => d2.items()[0]?.state === "acknowledged",
    "both hold revision 1",
  );
  d2.link.control.offline = true;
  await d2.coordinator.update(
    await routeContent("alice", 1, "Edit from device two"),
  );
  await d1.coordinator.update(
    await routeContent("alice", 1, "Edit from device one"),
  );
  await until(
    () =>
      titleOf(d2.items()[0]) === "Edit from device two" &&
      d1.items()[0]?.acknowledgedRevision === 2,
    "device one's edit applied",
  );

  d2.link.control.offline = false;
  d2.coordinator.retryNow();
  await until(
    () => d2.items()[0]?.state === "conflict",
    "device two shown the conflict",
  );
  assert.equal(d2.items()[0].conflict?.code, "edited-elsewhere");
  assert.equal(d2.items()[0].conflict?.remote?.revision, 2);
  const held = (
    await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))
  ).data()!;
  assert.equal(held.title, "Edit from device one");
  assert.equal(held.revision, 2);

  assert.ok((await d2.coordinator.resolveConflict(route(1), "keep-mine")).ok);
  await until(
    () =>
      d2.items()[0]?.state === "acknowledged" &&
      d2.items()[0].acknowledgedRevision === 3,
    "keep-mine applied on top",
  );
  assert.equal(
    (await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))).data()!.title,
    "Edit from device two",
  );
  await d1.coordinator.stop();
  await d2.coordinator.stop();
});

test("the rules alone would let a stale device delete a newer record; the coordinator's conditional delete does not", async () => {
  // Why the transaction exists: an owner's delete has no precondition in the rules.
  await assertSucceeds(
    setDoc(
      doc(as(env, "alice"), pathOf("alice", 9)),
      routeDocument(
        await validRouteRecord("alice", { id: routeId(9), engine: false }),
      ),
    ),
  );
  await assertSucceeds(deleteDoc(doc(as(env, "alice"), pathOf("alice", 9))));

  const d1 = device("alice", "d1");
  const d2 = device("alice", "d2");
  await d1.coordinator.create(await routeContent("alice", 1, "Original"));
  await until(
    () => d2.items()[0]?.state === "acknowledged",
    "both hold revision 1",
  );
  d2.link.control.offline = true;
  await d2.coordinator.remove(route(1));
  await d1.coordinator.update(
    await routeContent("alice", 1, "Edited meanwhile"),
  );
  await until(
    () => d1.items()[0]?.acknowledgedRevision === 2,
    "the edit applied",
  );
  d2.link.control.offline = false;
  d2.coordinator.retryNow();
  await until(
    () => d2.items()[0]?.state === "conflict",
    "the stale delete became a conflict",
  );
  assert.equal(d2.items()[0].change, "delete");
  assert.equal(
    (await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))).data()!.title,
    "Edited meanwhile",
  );

  assert.ok((await d2.coordinator.resolveConflict(route(1), "keep-mine")).ok);
  await until(
    () => d2.items().length === 0 && d1.items().length === 0,
    "deleted for both once the rider chose to",
  );
  assert.equal(
    (await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))).exists(),
    false,
  );
  await d1.coordinator.stop();
  await d2.coordinator.stop();
});

test("hard delete leaves no tombstone: the rules accept a blind re-create, so a create of unknown outcome is checked, not replayed", async () => {
  const d1 = device("alice", "d1");
  const d2 = device("alice", "d2");
  d1.link.control.loseNextWrites = 1;
  await d1.coordinator.create(
    await routeContent("alice", 1, "Saved, answer lost"),
  );
  await until(
    async () =>
      (await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))).exists(),
    "the create reached the cloud",
  );
  assert.equal(
    d1.items()[0].state,
    "retrying",
    "this device cannot know it was saved",
  );
  await until(
    () => d2.items()[0]?.state === "acknowledged",
    "device two saw it",
  );
  await d2.coordinator.remove(route(1));
  await until(
    async () =>
      !(await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))).exists(),
    "deleted by device two",
  );

  d1.clock.advance(5000);
  await until(
    () => d1.items()[0]?.state === "conflict",
    "device one refused to re-create it",
  );
  assert.equal(d1.items()[0].conflict?.code, "possibly-deleted");
  assert.equal(
    (await getDoc(doc(as(env, "alice"), pathOf("alice", 1)))).exists(),
    false,
  );

  // The hazard is real: a blind replay of the same create IS accepted by the rules.
  const blind = routeDocument(
    await validRouteRecord("alice", { id: routeId(1), engine: false }),
  );
  await assertSucceeds(
    setDoc(doc(as(env, "alice"), pathOf("alice", 1)), blind),
  );
  await d1.coordinator.stop();
  await d2.coordinator.stop();
});

test("account isolation on the real rules: another account's records and paths are unreachable, and the coordinator follows its session", async () => {
  const alice = device("alice", "a");
  await alice.coordinator.create(await routeContent("alice", 1, "Alice route"));
  await until(() => alice.items()[0]?.state === "acknowledged", "saved");

  // A connection signed in as bob is refused under alice's path, for reads and writes.
  const asBob = firestoreTransport(as(env, "bob"));
  assert.deepEqual(
    await asBob.write("alice", {
      kind: "create",
      collection: "routes",
      id: routeId(2),
      content: await routeContent("alice", 2),
    }),
    { kind: "rejected", code: "permission-denied" },
  );
  await assertFails(getDoc(doc(as(env, "bob"), pathOf("alice", 1))));

  // The same coordinator switched to bob shows nothing of alice's and never touches alice's path as bob.
  alice.session.set("bob");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(alice.items().length, 0);
  await alice.coordinator.create(await routeContent("bob", 3, "Bob route"));
  await until(
    () => alice.items()[0]?.state === "acknowledged",
    "bob's own route saved",
  );
  assert.equal(alice.items().length, 1);
  assert.equal(titleOf(alice.items()[0]), "Bob route");
  assert.ok(
    alice.link
      .connection("bob")
      .requests.every((request) => !request.includes("alice/")),
    "nothing was requested under alice's path as bob",
  );
  assert.equal(
    (await getDoc(doc(as(env, "alice"), pathOf("alice", 3)))).exists(),
    false,
  );
  assert.equal(
    (await getDoc(doc(as(env, "bob"), pathOf("bob", 3)))).exists(),
    true,
  );
  await alice.coordinator.stop();
});
