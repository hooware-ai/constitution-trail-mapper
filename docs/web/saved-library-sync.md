# Saved-library sync engine (issue #33, local engine slice)

**Status: reusable, tested engine. Not wired into the app, and not the whole of #33.** There is no sign-in, no Firebase Auth, no UI, no real Firestore adapter, no project, no credential and no production resource here. Everything runs against fakes and the **local** emulator under the `demo-trail-mapper` project. The record contract, rules and ownership rules it builds on are in [cloud-library-contract.md](cloud-library-contract.md) (#31/#77).

What it is: a provider-independent, asynchronous coordinator, `SavedLibraryCoordinator` in `webApp/src/cloud/sync/`, that keeps **one signed-in account's** saved routes and places in step with the cloud and says truthfully what has and has not been accepted. Its account, transport and storage are injected, so the later Firebase/IndexedDB adapters and the UI (#32/#33) plug into it without changing its rules.

## Files

| File                                                | Role                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/cloud/sync/types.ts`                           | The three boundaries (`AccountSession`, `LibraryTransport`, `LibraryStorage`), the journal shapes and what the UI reads            |
| `src/cloud/sync/coordinator.ts`                     | The engine                                                                                                                        |
| `src/cloud/sync/content.ts`                         | Boundary validation (uses the #77 contract validators) and content helpers                                                        |
| `src/cloud/sync/journal.ts`                         | Reading the persisted journal and cache back (untrusted input), and an in-memory storage                                          |
| `tests/support/cloud-sync-harness.ts`               | In-memory cloud that enforces the rules' semantics, a controllable transport, manual clock, faulty storage                        |
| `tests/unit/cloud-sync-*.test.ts`                   | 66 unit tests: basics, ownership, offline/retry/reload, conflicts and deletion races, two-device convergence, a seeded random walk |
| `tests/rules/saved-library-sync.test.ts` + adapter  | The engine against the real rules on the local emulator, through a **test-only** reference Firestore transport                    |

## The model

- The cloud's copy of a record is **acknowledged** and carries a `revision`.
- A rider's unsent change is a **journal entry**: at most one per record, holding what the rider wants (`put` content, or `delete`) and the revision it was based on (`null` for a record the cloud has never seen). Later edits replace what is wanted; a record created and removed before anything was sent simply disappears.
- An entry is **persisted before it is sent** (write-ahead) with its attempt marked `mayHaveApplied`. The mark clears only when the transport _proves_ the request never arrived. After a reload an attempt still marked is an attempt nobody knows the outcome of.
- Every send is **conditional**: a create only if the record is absent, an update or delete only at the revision the change was based on.
- Nothing is ever merged and the last writer never wins. Whatever the engine cannot prove is surfaced as a **conflict** the rider resolves.

## What the UI can truthfully show

`getSnapshot()` is an immutable, versioned view (use with `subscribe`; React's `useSyncExternalStore` fits). Each item has a `state`:

| State          | Meaning                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `acknowledged` | The cloud accepted this value; its revision is known.                                                                        |
| `pending`      | Only on this device so far: saved locally, waiting or being sent. **A local write is never shown as saved to the cloud.**    |
| `retrying`     | A send failed for a reason that may pass; it will be tried again (backoff 1 s doubling to 60 s, or `retryNow()`).            |
| `conflict`     | The cloud's copy disagrees. Nothing is sent until the rider chooses (`resolveConflict`). The cloud's copy is attached.       |
| `rejected`     | The cloud refused it (for example `permission-denied`). Kept, never retried automatically; `retry` or `discard`.             |

`change` says what the unsent change is (`create`, `update`, `delete`; a pending delete stays listed, marked as deleting). Snapshot-level fields: `phase` (`signed-out`, `loading`, `ready`, `unavailable`), `connection` (what the last exchange showed; not a promise about the network), `durable` (false when the journal could not be saved locally, so unsent changes would not survive a reload), `unreadable` (records from a newer build, never shown), `recovered` (damaged stored entries dropped on load) and per-state `counts`. Mutation results say `durable` too; **durable is not cloud acceptance.**

## The rules the engine follows (each is pinned by tests)

1. **One epoch per account change.** Reads, listeners, probes and sends are all started under the account's epoch (`AccountEpochs`, #77). Pending operations are keyed by UID.
2. **Stale callbacks are rejected immediately**, on the spot, not when a notification arrives: every continuation checks the session itself. A completion that lands after sign-out or an account switch is dropped, never applied to the new account, and a request is never sent for an account that is no longer current. Writes are never re-attributed.
3. **Nothing is shown for another account.** Deliveries must name the account (`readFor`), pass `acceptDelivery`, and every record must belong to it. Nothing is shown until that account's journal and cache are loaded.
4. **Duplicate and late completions are ignored** (each attempt has an id; a completion that no longer matches is dropped). Duplicate or reordered snapshots never move a record backwards.
5. **No resurrection from a stale read.** A record is accepted only if it is newer than what is held and is not an older copy of an incarnation known to be deleted (deleted ids are remembered, with their creation time, in the cache).
6. **A deletion is believed only from an authoritative read** (or this device's own acknowledged delete). A snapshot that merely lacks a record triggers a read; if the read cannot be made the record stays.
7. **A create whose outcome is unknown is never simply repeated.** The cloud is read first: found exactly as sent means acknowledged; found different means a conflict; **absent means a conflict (`possibly-deleted`), not a re-creation**.
8. **A change the cloud already holds is done** (identical concurrent edits converge; deleting twice is quiet).
9. **Otherwise it is an explicit conflict** (below). The rider's edit is kept untouched and nothing is overwritten.
10. **Unsent work is never lost silently.** Sign-out keeps the journal but, by default, clears the cached cloud copy. `unsentChanges(uid)` explains what is waiting; `forgetAccount(uid)` refuses while work is unsent or unreadable unless told it may be lost.

## Conflict policy (deterministic, documented, conservative)

| Situation                                                                 | Result                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Update or delete based on revision N, the cloud is at another revision    | `edited-elsewhere`, unless the cloud's copy already equals what the rider wants (then done)          |
| Update of a record that no longer exists                                  | `deleted-elsewhere`; the edit is kept; the record is **not** re-created                              |
| Create finds a different record under the id                              | `already-exists`                                                                                     |
| Create of unknown outcome and the record is absent                        | `possibly-deleted`                                                                                   |
| Delete of a record already gone                                           | Done                                                                                                 |
| Rider chooses **keep-theirs**                                             | The unsent change is dropped; the cloud's state stands                                               |
| Rider chooses **keep-mine**                                               | Re-based on the cloud's current revision and sent. For a record that is gone this saves it again, as the rider's explicit decision |

There is no last-write-wins and no automatic merge. A change to a record in conflict is refused (`in-conflict`) until resolved. A conflict, with the cloud's copy, survives a reload.

### The hard-delete limit, stated plainly

The contract deletes for real (privacy, account deletion): there is **no tombstone in the cloud**, and the rules let an owner delete without a precondition. So the cloud itself cannot refuse a blind replay of a create after the record was deleted elsewhere (`saved-library-sync.test.ts` shows the rules accept it). The engine therefore solves it in the client, with the three measures above: conditional writes through transactions (the transport contract), rule 7 for creates of unknown outcome, and rule 5/6 for stale reads. What it cannot do: recognise a create that was **delayed in the network and lands after a retry and an elsewhere-delete**; no client can without server-side idempotency. That residual is a documented limit, not something the tests claim to cover.

## Contracts for the injected parts

**Transport** (`LibraryTransport`; every call names the uid):

- `write` takes `create`, `update { expectedRevision }` or `delete { expectedRevision }` and must implement the preconditions atomically (in Firestore: one transaction that reads first). It answers `committed`/`deleted`, `precondition-failed` (the service evaluated it and refused: record present for a create; absent or another revision for update/delete), `rejected` (any other definitive refusal), `unavailable` (**provably** never sent) or `unknown`. **When in doubt an adapter must say `unknown`**: that one choice is what makes retries safe.
- `read` is authoritative (never a cache). `list` is bounded (at most 200, as the rules require). `listen` delivers full collections (`complete: true`) or increments plus explicit `removed` ids, and must not pass on deliveries served from a local cache.
- The coordinator validates everything that comes back (contract parsers, owner, id, expected revision) and treats malformed answers as `unknown`.

**Storage** (`LibraryStorage`): a per-UID journal (small, saved before every send) and a per-UID cache (acknowledged records and deleted-id markers, saved coalesced). The coordinator only ever asks for the current account's keys, drops entries that do not parse or name another account, and **never overwrites a journal it cannot understand** (`phase: unavailable`). A real adapter should use IndexedDB; cached routes carry their engine payload, so size the store for up to 200 routes.

**Session** (`AccountSession`): `current()` plus `subscribe`. Every change must be notified; the coordinator also re-reads `current()` at each boundary.

## Integration seams for #32 / #33 (nothing is wired)

- **Sign-in (#32)** supplies the `AccountSession`. **Save -> authenticate -> exactly one save:** generate the record id (`newRecordId()`) before authentication and call `create` once signed in; creating the same content again is idempotent and the same id is never reused, so a retry after the sign-in redirect cannot make a second record.
- **Firebase adapter:** map `LibraryTransport` as `tests/rules/firestore-transport.ts` does (transactions, `unknown` unless proven, timestamps and engine bytes converted at the boundary). Route requests to a connection signed in as the request's own uid.
- **UI:** read `getSnapshot()`; call `retryNow()` on the browser's `online` event; show `conflict`/`rejected` items with their actions; warn on sign-out using `unsentChanges`.
- **Reopening a saved route** must still run the current closure, proposed-trail and unverified-connection checks and `engineMatchesRecord`: the coordinator validates structure when a record arrives and checks the engine payload when something is **saved**, but does not decompress every incoming payload.
- **Local library and Recents** are unchanged and separate: nothing is uploaded or imported by the coordinator, and recents, drafts, GPS, rides, history and the trail graph never enter it. Whether existing local saves are shown beside, or replaced by, cloud saves is a product decision for #33/#51 (this slice does not rebrand local saves as cloud).
- Cached cloud data is distinct from offline basemap tiles and offline navigation (outside this issue).

## Verified, and not

| Item                                                                                                                            | Status                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Engine rules above against an in-memory cloud with the rules' semantics, including two independent coordinators                 | **Verified locally** (unit tests)         |
| The transport contract on the real committed rules (transaction preconditions, listeners, A/B isolation, the hard-delete hazard) | **Verified on the local emulator only**   |
| Real Firebase project, Auth providers (Google/Apple), real UIDs, authorized origins, deployed rules                              | **UNVERIFIED / not touched**              |
| Two real browsers or devices signed into one real account                                                                       | **Not tested**                            |
| Libraries above one bounded page (200 per collection): deletions elsewhere are only noticed through listeners' `removed` ids    | **Documented limit**                      |
| Delayed-in-network create landing after an elsewhere-delete (needs server idempotency)                                          | **Documented limit**                      |
| UI states, counts and copy; desktop/mobile flows; real-provider and device checks                                               | **Not built**                             |

## Tests and the negative checks behind them

`npm test` runs the unit tests (no emulator); `npm run test:rules` runs the emulator test with the rules suite. The random walk (`cloud-sync-convergence.test.ts`) runs 60 seeded sequences of creates, edits, deletes, outages, lost and unreported responses, outside edits and hard deletes on two devices, and checks: no write for another account, no record created twice, none re-created after a delete, no unsent work left, every device equal to the cloud. `TRAIL_WALK_SEEDS`/`TRAIL_WALK_STEPS` widen it (600 seeds of 70 steps pass). A further test fails if the walks stop reaching conflicts, rejections and retries.

Each guard was removed in turn and the suite had to fail (done locally, 13 of 13 caught): epoch check, late-notification check, blind replay of an unknown create, automatic recreation, tombstone guard, trusting snapshot absence, write-ahead order, last-write-wins, owner check, journal uid check, `readFor` check, stale cached copy of an unreadable record, and cache kept after sign-out.

## Unfinished at this checkpoint

The engine, its tests and this document are complete as a slice. Not done: the real Firebase and IndexedDB adapters, the UI wiring, the Save -> authenticate flow with #32, desktop/mobile browser flows, real-provider and device evidence, and the hosted review of this slice. #33 stays open.
