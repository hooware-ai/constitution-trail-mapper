# Native feature order in the package (UNAPPROVED engineering correction, local only)

Recorded 2026-10-04 in the local release-candidate worktree (`codex/web-release-candidate`). **This approves nothing and publishes nothing.** The committed approval stays `approved: false`, `approvedComposition: null`, approver and date null; every rights, data, device, hosting and public blocker is unchanged. The six Proposed features are still absent and still Jesse's pending scope decision; no first-release equivalence or publication claim is made. It follows [first-public-nonproposed-proof.md](first-public-nonproposed-proof.md), which measured an order difference between the package and native.

## The defect and the contract

The router's node ownership and tie-breaking follow feature order, so the order a package walks the trail features is part of its behavior. The old package differed from native in two places, both pre-existing:

1. County: `toNetworkText` sorted numerically by (layer id, object id), so layer 16 came before layer 54. Native walks the layer-54 block (59 Existing) and then layer 16 (195), each in object-id order.
2. OpenStreetMap: `osm-supplement.mjs` sorted the four ways lexically by id, shipping 1281779634 first. Native and the committed reviewed manifest list 1424898800, 854311297, 854311298, 1281779634.

Merely keeping the licensed extract's own order would not have helped (the extract is itself 16-first).

The contract is now explicit and needs no native asset at runtime: **the package walks the county features in the order of `features` in the committed reviewed manifest (`data/web-reviewed-trails.manifest.json`), then the four OSM ways in the order of `features` in `data/verified-trail-additions.manifest.json`.** Both lists were checked against native's own traversal (254 of 254 and 4 of 4 identical, layer 54 then 16, object-id order inside each). Each admitted county feature carries its manifest position (`reviewedIndex`), `toNetworkText` sorts by it and refuses a missing or duplicate position, and `admitSupplement` sorts the ways by their manifest position. Input order does not matter (shuffled input gives identical bytes).

The audit recomputes rather than copies: `checkPackage` refuses a county layer whose ids are not exactly the manifest sequence ("not in the reviewed traversal order"), and `checkSupplementLayer` re-admits the shipped OSM layer and compares it with the recomputed layer, so a wrong sequence that was consistently re-hashed is still refused. No geometry, attribute, identifier, membership, access road, tile `ord`, flag, Proposed or Start/closure rule changed.

## What changed

`webApp/tools/lib/dataset-package.mjs` (county order, order audit), `webApp/tools/lib/osm-supplement.mjs` (way order), tests in `tests/unit/dataset-package.test.ts` and `tests/unit/osm-supplement.test.ts` (synthetic 54/16 collision where numeric order would put 16 first; a manifest that lists 16 first packages 16 first, so the order is the manifest's and not hard-coded; reversed OSM manifest; shuffled input byte-identical; two self-re-hashed wrong sequences refused). The new tests fail on the old sorts (checked by restoring each old comparator). One existing test that pinned the old numeric order was corrected to the manifest order.

## New unapproved package (ignored, `webApp/generated/hypothesis-native-order-osm-20261004`)

Same licensed extract (SHA-256 `a374305a...`), same reused core (inputs `4291420e8abe`, output `ae80383c5457`, `verify-core` passes), same flags (`--osm-additions --access-roads`, no Proposed).

| | Old package | New package |
| --- | --- | --- |
| Version / combined identity | `2026-09-28.d9d53ab77c3c` | `2026-09-28.427875793d2c` |
| Network | `trails.cf14cf6d7730`, 730,918 bytes | `trails.903e43cf077a` (SHA-256 `903e43cf077acf79988920eb114b02e0f90bab022180aca88f5205c7a1ed882d`), 730,918 bytes |
| Features | 254 Existing (layer 8: 16-block, 54-block) + 4 OSM | 254 Existing (54-block, 16-block) + 4 OSM in manifest order |
| Access base / index | `544b1add4dd6` (3,424) / `672e9d1c8711` (440 tiles, 9,313 local roads, 10,323 assignments) | unchanged, hash for hash |
| Composition | `approvedComposition: null`, approved false, 5 blockers | `approvedComposition: null`, approved false, the same 5 blockers (the calculated composition is populated; its network and combined hashes legitimately differ) |

Static check against native (`static-checks.txt`): 258 of 258 per-id consumed fields identical, **0 of 258 positions differ in order**, no Proposed packaged, 3,424 base roads identical in order, 9,313 tile roads with native's ids and geometry. The tile arrival order still differs from native (the core reads tiles in the order added; the production loader and an exact-`ord` monolith agreed in the earlier proof).

## Behavior, native versus the real package with the production loader (`fixed-*.json`, `fixed-*.log`)

One process per configuration, run serially, own output names (the first attempt overlapped with another run and shared a log, so it was discarded and these were rerun cleanly). `facts()` records selected verdict evidence (geometry hash, distance, gap count, Start, closure ids, network status), not full raw-response equality. Every route exists before any verdict is read (the script fails otherwise). No manual reorder control is used: the package is built by the fixed packager and the access roads come through the real `AccessLoader` (base roads at initialize, tiles around each request's endpoints before each call).

| Step | native (264 features incl. the six Proposed, native access) | new package, production loader |
| --- | --- | --- |
| Illinois Central mapped p2p (54:2578, 15% to 85%) | 2239 m, 0 gaps, Start, geometry `3bda8570...` | **identical** (was 2243 m, a different route, on the old package) |
| Reviewed OSM way p2p (854311297) | 220 m, 0 gaps, Start | identical |
| Mapped-start 3 mi loop | 4892 m, 2 gaps, Start refused | **identical** (was 4766 m, a different route) |
| WARM own-configuration inspect of those three | current, same Start verdicts, geometry equal | identical |
| Actual Willow leg 97 to 98 (before / activation / after, Start, snapshot, recalculate, 5 m interior) | Start before (789 m, 0 gaps); refused at activation and after the estimate with the snapshot refused; recalculation routes around it with Start; the 5 m interior route refused and its recalculation refused | identical |
| COLD inspect of routes planned on NATIVE, after the package configuration is re-initialized (nothing loaded) | n/a | Illinois Central current (Start), OSM way **current (Start)** (was `stale`), loop current (Start refused) |

Isolation (`partial-county-only-*`): a package made with the county fix only (OSM ways still lexical) gives the same two route results as native (2239 m, 4892 m), so the county block order alone accounts for those; its cold native-planned OSM inspection is still `stale`, so the OSM order alone accounts for that. That earlier county-only package is labelled partial and kept (`static-checks-PARTIAL-county-order-only.txt`, `partial-county-only-*`). The previous `packaged-native-order` control reordered both county and OSM together, so it did not isolate either; this does.

## Limits

This is local engineering evidence on one extract, one core, the smallest previously logged request set and the actual Willow leg. It is not a wider request sample, not phone or outdoor behavior, not rights for any source, not an owner approval of any composition, and not first-release equivalence (the six Proposed features stay absent pending Jesse's decision). The mapped 3 mi loop has two estimated endpoint gaps and Start is refused in both, as policy requires. The broad 79-request probe was not rerun. The old package, its logs and scripts are kept as recorded.
