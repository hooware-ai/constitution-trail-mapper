# Offline admission to runtime binding

`bindRuntimeRelease` in `webApp/tools/lib/runtime-release-binding.mjs` verifies the
cross-PR hash and sequence interface. It produces a blocked binding record, not a
runtime manifest, approval, endpoint or deployment. Tests use explicitly synthetic
sequence decisions; Site version numbers and Git commit counts are never sequences.

The release owner supplies independently retained digests of the reproduced review,
complete prior ledger, accepted runtime manifest/history and explicit sequence
decision. The decision names the exact prior sequence, a higher target sequence,
release instant and issuer. These input pins establish integrity only: production
still needs an approved issuer, durable authoritative sequence allocation and
retained release history. No production authority or sequence has been assigned.

Both ledgers must bind the complete raw compiled catalogs, including inactive and
scheduled rules. Prior runtime pins must equal every prior compiled descriptor hash.
An accepted reopening's `supersedesSha256` hashes the **whole prior ledger entry**;
the runtime event's `fromContentSha256` hashes only its **compiled descriptor**.
The binding verifies the former before deriving the latter, and records both.
Evidence URL, reviewer, decision digest, affected IDs, baseline/target and review
instant are checked. Prior history is copied byte-equivalently; the new event binds
the exact supplied prior/target sequences. Added or changed descriptors are refused pending
a separately reviewed admission operation. This first helper supports retention and
explicit reviewed removals only. Skipped sequence numbers require this
explicit direct review; a producer must retain bridges for every supported client
floor or fail closed.

Before any use, reproduce the immutable artifact with `verifyReviewArtifact`,
retrieve its complete `baselineLedger` with `selectRollback` (evidence only), and
run actual compatible-core representative router controls. This helper does not
replace those gates. Approved source policies, provider/composition rights,
dataset approval, endpoint and activation decisions remain separate requirements.
No source execution, scheduling, native feature, sharing or default App behavior
changes. Existing approved flags remain false.

Run `node --test tests/unit/runtime-release-binding.test.mjs` from `webApp`.
