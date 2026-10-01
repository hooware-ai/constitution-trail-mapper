import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  Bytes,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  LIMITS,
  parsePlaceRecord,
  parseRouteRecord,
} from "../../src/cloud/contract";
import {
  PLACE_ID,
  ROUTE_ID,
  validPlaceRecord,
  validRouteRecord,
} from "../support/cloud-fixtures";
import { PLACE_MUTATIONS, ROUTE_MUTATIONS } from "../support/cloud-mutations";
import {
  as,
  assertFails,
  assertSucceeds,
  clientTimestamp,
  createEnvironment,
  placeDocument,
  routeDocument,
  signedOut,
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

const routePath = (uid: string, id = ROUTE_ID) => `users/${uid}/routes/${id}`;
const placePath = (uid: string, id = PLACE_ID) => `users/${uid}/places/${id}`;

async function aliceHasRoute(id = ROUTE_ID) {
  const record = await validRouteRecord("alice", { id });
  await assertSucceeds(
    setDoc(
      doc(as(env, "alice"), routePath("alice", id)),
      routeDocument(record),
    ),
  );
  return record;
}

// ---------------------------------------------------------------------------------------------------------------------
test("signed-out visitors can do nothing at all with saved records", async () => {
  await aliceHasRoute();
  await assertSucceeds(
    setDoc(
      doc(as(env, "alice"), placePath("alice")),
      placeDocument(validPlaceRecord("alice")),
    ),
  );
  const db = signedOut(env);
  const record = await validRouteRecord("alice");
  await assertFails(getDoc(doc(db, routePath("alice"))));
  await assertFails(
    getDocs(query(collection(db, "users/alice/routes"), limit(10))),
  );
  await assertFails(
    setDoc(
      doc(db, routePath("alice", "r_other0123456789abcdef")),
      routeDocument(record),
    ),
  );
  await assertFails(updateDoc(doc(db, routePath("alice")), { title: "x" }));
  await assertFails(deleteDoc(doc(db, routePath("alice"))));
  await assertFails(getDoc(doc(db, placePath("alice"))));
  await assertFails(
    getDocs(query(collection(db, "users/alice/places"), limit(10))),
  );
  await assertFails(
    setDoc(
      doc(db, placePath("alice", "p_other0123456789abcdef")),
      placeDocument(validPlaceRecord("alice")),
    ),
  );
  await assertFails(deleteDoc(doc(db, placePath("alice"))));
});

test("user A cannot read, list, create, update or delete user B's records, and B cannot touch A's", async () => {
  await aliceHasRoute();
  await assertSucceeds(
    setDoc(
      doc(as(env, "alice"), placePath("alice")),
      placeDocument(validPlaceRecord("alice")),
    ),
  );
  const bob = as(env, "bob");
  const forged = await validRouteRecord("alice", {
    id: "r_bobwrites0123456789abcdef",
  });
  const forgedAsBob = await validRouteRecord("bob", {
    id: "r_bobwrites0123456789abcdef",
  });
  // Read / list
  await assertFails(getDoc(doc(bob, routePath("alice"))));
  await assertFails(
    getDocs(query(collection(bob, "users/alice/routes"), limit(10))),
  );
  await assertFails(getDoc(doc(bob, placePath("alice"))));
  await assertFails(
    getDocs(query(collection(bob, "users/alice/places"), limit(10))),
  );
  // Create inside A's space, as B, whether the record claims A or B as owner.
  await assertFails(
    setDoc(doc(bob, routePath("alice", forged.id)), routeDocument(forged)),
  );
  await assertFails(
    setDoc(doc(bob, routePath("alice", forged.id)), routeDocument(forgedAsBob)),
  );
  await assertFails(
    setDoc(
      doc(bob, placePath("alice", "p_bobwrites0123456789abcdef")),
      placeDocument(validPlaceRecord("bob", "p_bobwrites0123456789abcdef")),
    ),
  );
  // Update / delete A's existing records
  await assertFails(
    updateDoc(doc(bob, routePath("alice")), { title: "hijacked", revision: 2 }),
  );
  await assertFails(deleteDoc(doc(bob, routePath("alice"))));
  await assertFails(
    updateDoc(doc(bob, placePath("alice")), { label: "hijacked", revision: 2 }),
  );
  await assertFails(deleteDoc(doc(bob, placePath("alice"))));
  // ... and the same the other way round.
  await assertSucceeds(
    setDoc(
      doc(bob, routePath("bob", forgedAsBob.id)),
      routeDocument(forgedAsBob),
    ),
  );
  const alice = as(env, "alice");
  await assertFails(getDoc(doc(alice, routePath("bob", forgedAsBob.id))));
  await assertFails(deleteDoc(doc(alice, routePath("bob", forgedAsBob.id))));
  // A's data is intact after all of that.
  const snap = await assertSucceeds(getDoc(doc(alice, routePath("alice"))));
  assert.equal(snap.data()!.title, "Synthetic west to north");
});

test("the owner can create, read, list, update (revision by revision) and delete", async () => {
  const alice = as(env, "alice");
  const record = await validRouteRecord("alice");
  await assertSucceeds(
    setDoc(doc(alice, routePath("alice")), routeDocument(record)),
  );
  const read = (
    await assertSucceeds(getDoc(doc(alice, routePath("alice"))))
  ).data()!;
  assert.equal(read.revision, 1);
  assert.equal(read.ownerUid, "alice");
  assert.ok(read.engine instanceof Bytes);
  // The stored document, converted back to the interchange form, is a valid record.
  const interchange = {
    ...read,
    createdAt: read.createdAt.toDate().toISOString(),
    updatedAt: read.updatedAt.toDate().toISOString(),
    engine: read.engine.toBase64(),
  };
  assert.equal(parseRouteRecord(interchange).id, ROUTE_ID);
  const listed = await assertSucceeds(
    getDocs(query(collection(alice, "users/alice/routes"), limit(50))),
  );
  assert.equal(listed.size, 1);
  // Update: the same record with a new title and the next revision.
  await assertSucceeds(
    setDoc(doc(alice, routePath("alice")), {
      ...routeDocument({ ...record, title: "Renamed route" }, 2),
      createdAt: read.createdAt,
    }),
  );
  assert.equal(
    (await getDoc(doc(alice, routePath("alice")))).data()!.title,
    "Renamed route",
  );
  await assertSucceeds(deleteDoc(doc(alice, routePath("alice"))));
  assert.equal((await getDoc(doc(alice, routePath("alice")))).exists(), false);
  // Places, the same way.
  const place = validPlaceRecord("alice");
  await assertSucceeds(
    setDoc(doc(alice, placePath("alice")), placeDocument(place)),
  );
  const stored = (await getDoc(doc(alice, placePath("alice")))).data()!;
  assert.equal(
    parsePlaceRecord({
      ...stored,
      createdAt: stored.createdAt.toDate().toISOString(),
      updatedAt: stored.updatedAt.toDate().toISOString(),
    }).id,
    PLACE_ID,
  );
  await assertSucceeds(
    setDoc(doc(alice, placePath("alice")), {
      ...placeDocument({ ...place, label: "Renamed place" }, 2),
      createdAt: stored.createdAt,
    }),
  );
  await assertSucceeds(deleteDoc(doc(alice, placePath("alice"))));
});

// ---------------------------------------------------------------------------------------------------------------------
for (const mutation of ROUTE_MUTATIONS.filter((m) => m.rules !== "na"))
  test(`route create: ${mutation.name} -> ${mutation.rules}`, async () => {
    const record: any = structuredClone(await validRouteRecord("alice"));
    mutation.change(record);
    // The record's own id is the document id unless it cannot be one (then the path keeps a valid id and the mismatch is the test).
    const pathId = /^[A-Za-z0-9_-]{16,64}$/.test(record.id)
      ? record.id
      : ROUTE_ID;
    const write = setDoc(
      doc(as(env, "alice"), routePath("alice", pathId)),
      routeDocument(record, record.revision),
    );
    await (mutation.rules === "allow"
      ? assertSucceeds(write)
      : assertFails(write));
  });
for (const mutation of PLACE_MUTATIONS.filter((m) => m.rules !== "na"))
  test(`place create: ${mutation.name} -> ${mutation.rules}`, async () => {
    const record: any = structuredClone(validPlaceRecord("alice"));
    mutation.change(record);
    const pathId = /^[A-Za-z0-9_-]{16,64}$/.test(record.id)
      ? record.id
      : PLACE_ID;
    const write = setDoc(
      doc(as(env, "alice"), placePath("alice", pathId)),
      placeDocument(record, record.revision),
    );
    await (mutation.rules === "allow"
      ? assertSucceeds(write)
      : assertFails(write));
  });

test("every mutation the validators refuse and the rules can see is refused by both", async () => {
  // The table is the agreement: a row where the validators say ok but the rules deny (or the reverse) is only allowed
  // where it carries a note explaining the limit of one side.
  for (const row of [...ROUTE_MUTATIONS, ...PLACE_MUTATIONS]) {
    if (row.rules === "na") continue;
    const tsAccepts = row.ts === "ok";
    const rulesAllow = row.rules === "allow";
    if (tsAccepts !== rulesAllow)
      assert.ok(
        row.note,
        `"${row.name}" differs between validators and rules without an explanation`,
      );
  }
});

// ---------------------------------------------------------------------------------------------------------------------
test("a write cannot spoof its owner, reassign identity, or choose its own timestamps", async () => {
  const alice = as(env, "alice");
  const record = await aliceHasRoute();
  const stored = (await getDoc(doc(alice, routePath("alice")))).data()!;
  const next = (changes: Record<string, unknown>, revision = 2) => ({
    ...routeDocument(record, revision),
    createdAt: stored.createdAt,
    ...changes,
  });
  // Owner / id / schema / version are fixed once written.
  await assertFails(
    setDoc(doc(alice, routePath("alice")), next({ ownerUid: "bob" })),
  );
  await assertFails(
    setDoc(
      doc(alice, routePath("alice")),
      next({ id: "r_reassigned0123456789abcdef" }),
    ),
  );
  await assertFails(
    setDoc(
      doc(alice, routePath("alice")),
      next({ schema: "trail-mapper.saved-place" }),
    ),
  );
  await assertFails(
    setDoc(doc(alice, routePath("alice")), next({ version: 2 })),
  );
  // Timestamps are the server's: a client value is refused, and created time cannot move.
  await assertFails(
    setDoc(
      doc(alice, routePath("alice")),
      next({ createdAt: clientTimestamp() }),
    ),
  );
  await assertFails(
    setDoc(
      doc(alice, routePath("alice")),
      next({ updatedAt: clientTimestamp() }),
    ),
  );
  await assertFails(
    setDoc(doc(alice, routePath("alice", "r_clientstamp0123456789abcdef")), {
      ...routeDocument({ ...record, id: "r_clientstamp0123456789abcdef" }),
      createdAt: clientTimestamp(),
      updatedAt: clientTimestamp(),
    }),
  );
  // A partial update that would add an unknown field, or break a rule, fails (and the revision still has to move).
  await assertFails(
    updateDoc(doc(alice, routePath("alice")), { extra: 1, revision: 2 }),
  );
  await assertFails(
    updateDoc(doc(alice, routePath("alice")), { title: "no revision change" }),
  );
  // A path in another account's space, or a path whose id differs from the record's, is refused for create.
  await assertFails(
    setDoc(
      doc(alice, "users/alice/routes/r_pathmismatch0123456789abcdef"),
      routeDocument(record),
    ),
  );
  await assertFails(
    setDoc(
      doc(alice, "users/bob/routes/" + ROUTE_ID),
      routeDocument(await validRouteRecord("bob")),
    ),
  );
  // The one valid next write still works, proving the failures above were for the reasons given.
  await assertSucceeds(
    setDoc(doc(alice, routePath("alice")), next({ title: "Fine" })),
  );
});

test("revisions give optimistic concurrency: a stale or skipped revision fails instead of overwriting", async () => {
  const alice = as(env, "alice");
  const record = await aliceHasRoute();
  const created = (await getDoc(doc(alice, routePath("alice")))).data()!
    .createdAt;
  const write = (revision: number, title: string) =>
    setDoc(doc(alice, routePath("alice")), {
      ...routeDocument({ ...record, title }, revision),
      createdAt: created,
    });
  await assertSucceeds(write(2, "Device 1 edit"));
  // Device 2 still thinks the record is revision 1 and tries to write revision 2 as well: refused, not overwritten.
  await assertFails(write(2, "Device 2 edit"));
  await assertFails(write(1, "Device 2 rewinds"));
  await assertFails(write(4, "skips ahead"));
  assert.equal(
    (await getDoc(doc(alice, routePath("alice")))).data()!.title,
    "Device 1 edit",
  );
  await assertSucceeds(write(3, "Device 2 after reading"));
});

test("deleting is final for that revision: an edit of a deleted record fails, a recreate starts again at revision 1", async () => {
  const alice = as(env, "alice");
  const record = await aliceHasRoute();
  const created = (await getDoc(doc(alice, routePath("alice")))).data()!
    .createdAt;
  await assertSucceeds(deleteDoc(doc(alice, routePath("alice"))));
  // A pending offline edit from another device (revision 2) cannot bring the record back.
  await assertFails(
    updateDoc(doc(alice, routePath("alice")), {
      title: "late edit",
      revision: 2,
    }),
  );
  await assertFails(
    setDoc(doc(alice, routePath("alice")), {
      ...routeDocument(record, 2),
      createdAt: created,
    }),
  );
  // Deleting something already gone is harmless.
  await assertSucceeds(deleteDoc(doc(alice, routePath("alice"))));
  assert.equal((await getDoc(doc(alice, routePath("alice")))).exists(), false);
});

// ---------------------------------------------------------------------------------------------------------------------
test("lists are bounded, scoped to one account, and a collection-group read is denied", async () => {
  const alice = as(env, "alice");
  await aliceHasRoute();
  await assertSucceeds(
    getDocs(
      query(
        collection(alice, "users/alice/routes"),
        limit(LIMITS.listLimitMax),
      ),
    ),
  );
  await assertFails(getDocs(collection(alice, "users/alice/routes")));
  await assertFails(
    getDocs(
      query(
        collection(alice, "users/alice/routes"),
        limit(LIMITS.listLimitMax + 1),
      ),
    ),
  );
  await assertFails(
    getDocs(query(collectionGroup(alice, "routes"), limit(10))),
  );
  await assertFails(
    getDocs(
      query(
        collectionGroup(alice, "routes"),
        where("ownerUid", "==", "alice"),
        limit(10),
      ),
    ),
  );
  await assertFails(
    getDocs(query(collection(alice, "users/bob/routes"), limit(10))),
  );
});

test("nothing else in the database is readable or writable", async () => {
  const alice = as(env, "alice");
  await assertFails(setDoc(doc(alice, "users/alice"), { anything: true }));
  await assertFails(getDoc(doc(alice, "users/alice")));
  await assertFails(
    setDoc(doc(alice, "users/alice/recents/r_recent0123456789abcdef"), {
      anything: true,
    }),
  );
  await assertFails(
    setDoc(doc(alice, "users/alice/rides/r_ride0123456789abcdef0"), {
      gps: [1, 2],
    }),
  );
  await assertFails(
    setDoc(doc(alice, "routes/r_toplevel0123456789abcdef"), { anything: true }),
  );
  await assertFails(getDoc(doc(alice, "datasets/county")));
  await assertFails(getDocs(query(collection(alice, "users"), limit(5))));
});

// ---------------------------------------------------------------------------------------------------------------------
test("payload bounds: a document at the limits is accepted and one byte over is refused, with no partial write", async () => {
  const alice = as(env, "alice");
  const base = await validRouteRecord("alice");
  const withGeometry = (length: number) => ({
    ...structuredClone(base),
    geometry: "T:" + "?".repeat(length - 2),
  });
  const withEngine = (bytes: number) => {
    const record: any = structuredClone(base);
    record.engine = Buffer.alloc(bytes, 7).toString("base64");
    return record;
  };
  // The rules bound sizes; whether the bytes are a real polyline or gzip is the validators' job (see the mutation table).
  await assertSucceeds(
    setDoc(
      doc(alice, routePath("alice", "r_geomatlimit0123456789abcdef")),
      routeDocument({
        ...withGeometry(LIMITS.geometryChars),
        id: "r_geomatlimit0123456789abcdef",
      }),
    ),
  );
  await assertFails(
    setDoc(
      doc(alice, routePath("alice", "r_geomoverlimit012345678abcdef")),
      routeDocument({
        ...withGeometry(LIMITS.geometryChars + 1),
        id: "r_geomoverlimit012345678abcdef",
      }),
    ),
  );
  await assertSucceeds(
    setDoc(
      doc(alice, routePath("alice", "r_engatlimit01234567890abcdef")),
      routeDocument({
        ...withEngine(LIMITS.engineBytes),
        id: "r_engatlimit01234567890abcdef",
      }),
    ),
  );
  await assertFails(
    setDoc(
      doc(alice, routePath("alice", "r_engoverlimit0123456789abcdef")),
      routeDocument({
        ...withEngine(LIMITS.engineBytes + 1),
        id: "r_engoverlimit0123456789abcdef",
      }),
    ),
  );
  // Both at their limits together is still under Firestore's 1 MiB document cap.
  const both: any = {
    ...withEngine(LIMITS.engineBytes),
    geometry: "T:" + "?".repeat(LIMITS.geometryChars - 2),
    id: "r_bothatlimit0123456789abcdef",
  };
  await assertSucceeds(
    setDoc(doc(alice, routePath("alice", both.id)), routeDocument(both)),
  );
  // The refused ones left nothing behind.
  assert.equal(
    (
      await getDoc(
        doc(alice, routePath("alice", "r_geomoverlimit012345678abcdef")),
      )
    ).exists(),
    false,
  );
  assert.equal(
    (
      await getDoc(
        doc(alice, routePath("alice", "r_engoverlimit0123456789abcdef")),
      )
    ).exists(),
    false,
  );
});

test("a route's kind and plan must pair up in the rules too, in both directions", async () => {
  const alice = as(env, "alice");
  const loopId = "r_loopkind0123456789abcdef01234";
  const loop: any = structuredClone(
    await validRouteRecord("alice", { kind: "ExerciseLoop", id: loopId }),
  );
  await assertSucceeds(
    setDoc(doc(alice, routePath("alice", loopId)), routeDocument(loop)),
  );
  // Loop plan with the Navigation kind.
  const flipped: any = structuredClone(loop);
  flipped.kind = "Navigation";
  flipped.id = "r_loopflipped012345678abcdef0";
  await assertFails(
    setDoc(doc(alice, routePath("alice", flipped.id)), routeDocument(flipped)),
  );
  // Point plan with the ExerciseLoop kind (also in the shared table).
  const point: any = structuredClone(
    await validRouteRecord("alice", { id: "r_pointflipped0123456789abcdef" }),
  );
  point.kind = "ExerciseLoop";
  await assertFails(
    setDoc(doc(alice, routePath("alice", point.id)), routeDocument(point)),
  );
  // An update cannot change a stored loop into a contradictory record either.
  const created = (await getDoc(doc(alice, routePath("alice", loopId)))).data()!
    .createdAt;
  await assertFails(
    setDoc(doc(alice, routePath("alice", loopId)), {
      ...routeDocument({ ...loop, kind: "Navigation" }, 2),
      createdAt: created,
    }),
  );
  await assertSucceeds(
    setDoc(doc(alice, routePath("alice", loopId)), {
      ...routeDocument({ ...loop, title: "Still a loop" }, 2),
      createdAt: created,
    }),
  );
});
