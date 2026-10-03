# First-public candidate without the six Proposed features: local packaging proof (UNAPPROVED engineering hypothesis)

Recorded 2026-10-03 in the local release-candidate worktree. **This approves nothing and publishes nothing.** The committed approval stays `approved: false`, `approvedComposition: null`, approver and date null, and every rights, data, device, hosting and public blocker is unchanged. Deferring the six Proposed features from a first public scope is still the owner's decision and has not been granted. Nothing here is a native-parity claim for the public build: only the checks listed below were run.

## What was combined and built

| Item | Value |
| --- | --- |
| Local candidate | branch `codex/web-release-candidate`; the reviewed PR 83 head `db57ce7` merged forward on top of `681c2f8` (which already contains native `main` `9c31ae3`). One conflict, `docs/web/README.md`, resolved by keeping both links. Local only: nothing pushed, retargeted, rebased, reset or deployed. |
| Kotlin core | rebuilt once in this worktree (the older core there was stale): inputs `4291420e8abe` (205 files), output `ae80383c5457`; `verify-core` passes. The same inputs built in the PR 83 worktree give the same output hash on this machine. |
| Extract used | `data/generated/web-licensed-trails.normalized.json` from the `ctm-web-47` worktree: 2,117,493 bytes, SHA-256 `a374305a395761c42bcff56f0e7b2b9162506b401ffdc96bc88206a34b5b68e6`. The other existing extract (`ctm-web`, `95ed9366...`) is refused by the packager ("no source domain mapping"). |
| Packaged (ignored `webApp/generated/hypothesis-*`, no `--proposed-trails`) | `node tools/package-dataset.mjs --input <extract> --out <temp> --osm-additions --access-roads data/generated/mclean-access-roads.normalized.json`. Version `2026-09-28.d9d53ab77c3c`; network `trails.cf14cf6d7730` (SHA-256 `cf14cf6d7730394a074948b495290ce7e1b70a97f4ab6656eba971ceefd733fe`, 730,918 bytes): layer 8 with 254 Existing features and layer `verified-osm` with 4 ways = 258; access base `544b1add4dd6` (3,424 TIGER roads), access index `672e9d1c8711` (440 tiles, 9,313 endpoint-local OSM service roads, 10,323 tile assignments), combined `d9d53ab77c3c80158df908d7f108621f106c6eb00107d7b462fc69b29100c576`; approval false, composition null, 5 blockers. |
| Native assets (hashes match the recorded values) | county `310f1d50326a207ea22eb05cda78759bc62d1c4df55bd0515f6608f974b8b3a8`, OSM `2f97e23b5d6dae09be245772c9cfebfab13c44fe71df6a60a6d93a63797ae317`, access `23a9719dd45297352cef641014697ca0b263184af9fdace48573b0d6ba264d07`. |

Probe scripts and every log are in `release-candidate-logs/first-public-nonproposed/` (`hypothesis-proof.mjs` static checks, `hp-config.mts` behavior set).

## Static equivalence (same ordered inputs?)

| Check | Result |
| --- | --- |
| Native default-active features (county Existing + 4 OSM) vs packaged | 258 and 258; per id, geometry, status, route role, facility type, comfort and name all identical; no Proposed packaged |
| Base access roads | 3,424 of 3,424 identical in order, id, geometry, class and name |
| Endpoint-local service roads | 9,313 tile features have exactly native's ids and geometry (0 missing, 0 extra, 0 geometry differences); each carries `ord`, and sorting by `ord` reproduces native's order exactly (0..9312, contiguous) |
| **Trail feature ORDER** | **DIFFERS at all 258 positions.** Native loads layer 54 (59 Existing) then layer 16 (195) then the OSM ways; the packaged file is `[16-block][54-block][OSM]`. Within each block the order is the same as native's. The cause is `toNetworkText` in `tools/lib/dataset-package.mjs` (lines 449-453), which sorts numerically by (layer id, object id), so 16 precedes 54. It pre-dates this proof. |

## Behavior through the real core (smallest set; one process per configuration, each step logged at once, all exit 0)

Configurations kept separate: `native` (264 features including the six Proposed, native order, native access), `native-no-proposed` (native order, only the six Proposed removed), `packaged-native-order` (the packaged data reordered into native's order, native access: a control), `packaged-monolith` (packaged order, access reconstructed in exact `ord` order: a labelled control) and `packaged-production` (packaged order, the real `AccessLoader`: base roads at initialize, tiles around each request's endpoints added through `addAccess`; the cold control that reflects the browser loader). Every request is made with Proposed off.

| Step | native | native-no-proposed | packaged-native-order | packaged-monolith | packaged-production |
| --- | --- | --- | --- | --- | --- |
| Illinois Central mapped p2p (54:2578 vertices at 15% and 85%) | 2239 m, 0 gaps, Start | identical | identical | **2243 m** (different route), Start | same as monolith |
| Reviewed OSM way mapped p2p (`verified-osm:way:854311297`) | 220 m, 0 gaps, Start | identical | identical | identical | identical |
| Mapped-start 3 mi loop (Illinois Central) | 4892 m, 2 gaps, Start refused | identical | identical | **4766 m** (different route), 2 gaps, Start refused | same as monolith |
| Cold inspect of the three on the same configuration | current; Start verdicts unchanged; geometry equal | - | - | current, same | current, same |
| Actual Willow leg 97 to 98: before / activation / after, Start, snapshot, recalculate, 5 m inside | Start before (789 m, 0 gaps); refused at activation and after the estimate, snapshot refused; recalculation routes around; the 5 m inside route refused and its recalculation refused | identical in all five configurations | | | |

Reading it:

- **Removing the six Proposed features changes nothing**: `native-no-proposed` equals `native` on every step.
- **The packaged DATA equals native's**: `packaged-native-order` equals `native` on every step.
- **The one remaining effect is the trail feature ORDER.** In the packaged order two of three representative requests choose a different route (4 m longer for Illinois Central; 126 m shorter for the 3 mi loop). That is the graph's node ownership and tie-breaking following feature order, the same family of effect as the node-anchored chords handled in PR 83. The production loader and the `ord` monolith agree, so tile arrival order is not the cause.
- A route planned on native is, on the packaged order, `current` for Illinois Central and the loop, but the reviewed OSM way route is `stale` (`geometry-changed`: node-anchored geometry follows ownership). Routes planned by the packaged configuration itself are current there. Whether any rider holds a native-planned route in the web is not established; the two stores are separate.
- **Positive Start controls (all 0 gaps, Start allowed, current):** Illinois Central p2p, reviewed OSM p2p and Willow before activation, in every configuration. The mapped 3 mi loop picked here has two estimated endpoint gaps and is refused in all of them (policy unchanged); the earlier recorded mapped start on Route 66 and Illinois Central with a 2.95 mi loop was not re-picked.

## What is and is not established

- Established, locally and with the real core on these inputs: the packaged 254 + 4 + 12,737 data equals native's content; omitting the six Proposed features changes no default result; the actual Willow closure behaves identically in every configuration; the production access loader gives the same results as an exact-`ord` monolith; the packaged order is the only source of the representative route differences.
- Not established: public native-parity (the order effect above is a measured difference), any wider request set, phone or outdoor behavior, rights for any source, any owner approval. A fix would be to emit features in the extract's own order in `toNetworkText`, which the `packaged-native-order` control shows removes the difference on this set; it is not applied here and the committed packaging is unchanged.
- The first attempt at a larger probe (79 requests in three configurations) timed out without behavior output; the static results it printed are kept in `static-checks-and-timeout-of-first-attempt.txt`, and the set above replaced it.
- Native Android's Start checks only a blocking closure and has no separate Proposed guard (see the qualification in `native-parity.md`); the six features are absent from this packaged scope, which is the reason they cannot be reached, not a Start rule.
