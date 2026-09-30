# County dataset candidate (#47) and saved-route revalidation (#31 slice)

This is the production data path for the web app: a county-only **candidate** built from the 254 reviewed existing trail features, loaded from an explicit hash-named file, with saved routes checked against whatever data is loaded. It produces a **review candidate, not an approved dataset**: `approved` stays `false`, public release stays blocked, and no source date, approval or legal clearance is invented.

## Three data sources that never mix

| Source               | Where it comes from                                                    | Where it can run                        | Saved-route namespace   |
| -------------------- | ---------------------------------------------------------------------- | --------------------------------------- | ----------------------- |
| Synthetic fixture    | `src/data/review-network.json`, bundled                                | default build, dev server               | `trail-mapper.fixture:` |
| Private local review | files read by the dev server's loopback `/local-review-data` endpoint  | dev server with `?data=local` only      | `trail-mapper.local:`   |
| County candidate     | `data/dataset.json` + `data/trails.<sha12>.json`, fetched and verified | builds made with `TRAIL_DATASET=county` | `trail-mapper.county:`  |

The source is fixed by the **build** (`TRAIL_DATASET`, a compile-time constant), never by a runtime fallback. A county build removes the fixture module from the bundle, so it cannot serve fixture trails: on first boot, after a reload, after a worker restart and on every retry it loads the county file or shows why it could not. `TRAIL_CHANNEL=public` additionally refuses any dataset whose record is not approved (`data-unapproved`); that build shows the reason and no map data.

## What is admitted

`tools/lib/dataset-package.mjs` reads the private extract written by `python tools/fetch-web-review-data.py` (`data/generated/web-licensed-trails.normalized.json`, ignored by Git) and admits **exactly** the features listed in the committed `data/web-reviewed-trails.manifest.json`, with canonical `54:<objectId>` / `16:<objectId>` ids. It refuses the whole package (writing nothing, leaving any earlier package untouched) when any of these drift:

- a feature not in the manifest, missing, or duplicated; a feature that is no longer `Existing`, or from a layer other than the one licensed layer (8);
- **geometry or attributes that do not hash to the reviewed evidence.** The digests are recomputed from the geometry and the raw source attributes actually in the file, in the extractor's canonical form (`tools/lib/canonical-json.mjs` keeps each number's source text so integers written as `1.0` and small exponents still reproduce Python's bytes). A copied `geometrySha256` label proves nothing: replacing every path in the real extract with a two-point line is refused. This needs the raw attributes, which the extractor now keeps in `provenance.attributes`; an extract made before that change is refused with the instruction to regenerate it;
- routing roles, name, facility id and coded values that disagree with the authenticated attributes; **decoded labels that are not the reviewed domain's name for the authenticated code**. The extract carries the source's coded-value mapping, which must hash to the manifest's `licensedDomainsSha256`; each label is then derived from it, so a whole code cannot be quietly re-labelled (changing the three "Strong and Fearless" trails to "All Ages and Abilities" would drop their comfort weight from 1.75 to 1.0);
- source URL, license or license URL, review date; missing attribution, license evidence or change disclosure;
- any of the six omitted proposed ids (54:1929, 54:1952, 54:2349, 54:3824, 54:4275, 54:4772) or an OSM/supplement layer.

The shipped network keeps the geometry and raw attributes byte-for-byte as the extractor wrote them, so the **artifact audit recomputes the same digests from the shipped file** and re-checks roles, names, the domain digest and every decoded label. Output is deterministic for the same inputs. The package is written to `webApp/generated/county/` (ignored) by staging in a sibling directory and renaming, so a failed or interrupted run leaves no half-written package.

Nothing is widened or connected: no OSM supplements, no street access graph, no manufactured connections. Routes exist only where the reviewed trails themselves meet, and a missing connection is never treated as usable.

## Commands (only the first contacts a server; it reads the public licensed endpoints)

    python tools/fetch-web-review-data.py          # repo root; the extractor reads the public licensed service (needs the raw-attribute version of the tool)
    cd webApp
    npm run package:dataset                        # admission + packaging into generated/county
    TRAIL_DATASET=county npm run build             # PowerShell: $env:TRAIL_DATASET="county"; npm run build
    npm run verify:county                          # re-authenticate the package against the reviewed manifest
    npm run release:check -- --dataset county      # full clean-source check with the county build
    node tools/analyze-county.mjs [--all]          # coverage, connectivity, real-data route cases and revalidation

`--public` (with `TRAIL_CHANNEL=public`) is still expected to fail: the committed approval record says why.

## Identity, provenance and approval

`data/dataset.json` (schema `trail-mapper.dataset/1`) names the dataset id and version (`<reviewedOn>.<sha12>`), the network file (`trails.<sha12>.json`, schema `trail-mapper.network/1`) with its SHA-256, size and feature counts, and the source: review date, **extraction time** (when our extractor ran, _not_ when the county last changed anything), the SHA-256 of the reviewed manifest, license name and URL, license evidence URL and hash, attribution, the change disclosure ("Reviewed subset selected; attributes decoded and normalized; source geometry retained.") and the source's own disclaimer. It also records what was omitted (the six proposed ids, OSM supplements, street access) and the approval block.

The **approval block is copied from the committed `webApp/release/dataset.county.json`** and from nowhere else: `approved: false`, `approvedBy: null`, `approvedOn: null`, with five listed blockers (unresolved rights for the six proposed geometries, unresolved ODbL classification of a merged OSM graph, no owner approval, no physical-device acceptance, open hosting/basemap/sign-in decisions). Only the owner changes that file.

At runtime the worker refuses (visibly, with a Retry) data that is missing (`data-missing`), unreachable (`data-unavailable`), altered/truncated/mismatched (`data-corrupt`, from length, SHA-256, JSON and feature-count checks), in a format this build does not know (`data-incompatible`) or unapproved in a public build (`data-unapproved`). Retry starts a fresh worker and fetches again; there is no automatic retry loop.

`dist/provenance.json` for a county artifact records the dataset kind, id, version, content hash, source manifest hash, review date and extraction time. `tools/audit-dist.mjs` **recomputes** everything from the shipped files: content hash and size, manifest hash against the committed manifest, the exact 254-id set with the excluded ids absent, per-feature evidence hashes, that the shipped record's id/approval/attribution equal the committed approval record, and that no fixture network data is inside. Any difference is a blocker, and a package made from a different manifest or approval record than the committed ones is always non-publishable.

## Where the rider sees it

- **Banner and Updates/Explore**: "Review candidate · county trail data that is not approved for public release." (or the approved wording, once the owner approves), plus a **Trail data** section: dataset version, attribution, license link, source item, the change disclosure, review date and extraction date (with the statement that the county's own update date is unknown), feature count, what is not included, and the approval state and blockers (review channel).
- **Map credit**: the county and license, not the older OSM/Census wording, in county mode.
- **Saved routes** record which dataset they were planned on (`dataset: {kind, id, version, contentSha256}`, optional, validated); an older route on an earlier data version is still checked and shows a note when it still matches.
- **GeoJSON export** carries the dataset id/version/hash, license and link, change disclosure, review date, extraction time and approval flag, and the attribution names the county license and changes.

## Saved-route and restored-ride revalidation

Every inspection, navigation start, position evaluation and ride restore is checked by the shared Kotlin bridge against the network loaded now, per edge: the feature still exists (by its canonical id), keeps its status, is still eligible under the route's own layer choices, and still lies along the same geometry. A route that was `Existing` when saved but is `Proposed` now fails. Routes with no feature identities (saved before this change) are `unverifiable` outside the fixture. Results:

- **current**: proceeds exactly as before (closures and access warnings still apply);
- **stale / unverifiable**: the route and its geometry are **preserved**, shown with the specific changes and a "Recalculate on current data" action; `canNavigate` is false, **Start is disabled**, a position evaluation is refused, and a restored ride is **not resumed**. Recalculation replaces the route only when the rider asks (with the existing undo). A stale route **cannot be exported**: its lines would otherwise be labelled verified trail.

Geometry rule: there is no tolerance around the feature. The check builds the trail graph the way the planner does (the enabled trails with today's closures cut out, and the uncut graph as a fallback when a closure applies) and requires every drawn line of an edge to be a piece of geometry that graph derives from that feature within 0.5 m, checked leg by leg rather than at sample points (each straight leg must lie along a single derived segment, so a redraw that only differs between any two points is caught, and a line whose vertices differ from the derived ones is conservatively treated as changed): a node-to-node run, a junction connector, or either with its ends anchored to the graph's nodes, which is what snapped start and destination points are cut from. A trail that moved, was redrawn or was replaced has no matching derived geometry; a normal route over an unchanged network always does, including the long node-anchored edges that appear when a nearby trail end pulls a node away from a trail's own end. Verdicts are cached under a key made of every coordinate, identity and closure state the check reads, compared for equality.

Replacement workers (restart, cancellation) boot on **exactly the dataset the page started with**: the page pins the record it loaded and the worker fetches that hash-named file, so the identity saved with a route, the map, the Trail data section and exports always describe the data being routed on. If the site has since replaced that file the restart says so and asks for a reload, which is when newer data is adopted and saved routes are re-checked against it. Proposed trails stay opt-in; a stale check never turns one on.

## Verification

**Real 254-feature package** (extract regenerated with the raw attributes, packaged 2026-09-30): `2026-09-28.e9d359180641`, 724,932 bytes, all 254 geometry and attribute digests reproduced, the six proposed ids absent, `approved: false`. The release audit passes on a county build of it; the smoke tests pass against it.

**Real-data behaviour** (`node tools/analyze-county.mjs --all`, the Kotlin core run in-process over the packaged network; no street access data, so "disconnected" means "not joined by the reviewed trails"):

- Coverage: 254 trail features, about 298 km, bounding box 40.28-40.76 N, 89.21-88.71 W.
- Connectivity: **21 connected parts**. The largest holds 223 features (88%, about 250 km); 13 parts are a single trail (the longest 9.5 km) and seven hold 2-4 features (0.8-3.4 km). The router agreed with the geometric prediction on 17 of 18 checked pairs; the one disagreement (16:69 and 16:1773 look joined by geometry but the router has no route between them) is left as an unexplained limit, not smoothed over.
- Cases: point-to-point across the largest part, 26.6 mi and 7.5 mi, navigable; 3, 5, 10 and 25 mile loops matched their targets (2.96, 5.02, 10.07, 25.26 mi; 1.3-8.5 mi retraced); a route to a different part, or to a trail that joins nothing, finds no route; a start far from every trail produces one unverified connection and is not navigable.
- Unverified connections: 29 of the 240 routes from every trail to one anchor needed one (largest 15 m); none is navigable. Closures: the one known closure sits on 54:1305; a route starting there is made by an unverified connection and is not navigable.
- Revalidation on real geometry: 240 routes were reopened and **none was judged changed** (211 current; the other 29 are the unverified-connection routes above). The 249 routes the analysis itself made (point-to-point, loops, cases) were reopened too and all were current, and recalculating six of them gave current routes. Running this on the real network is what showed that edges legitimately leave a trail near their ends (snapped nodes, node-anchored partial edges), which two earlier tolerance-based versions of the check got wrong in opposite directions; the check now compares against the geometry the graph itself derives.
- Speed: planning a route takes 0.35-0.5 s in-process on this development machine, a 10-mile loop 4.7 s and a 25-mile loop 8.3 s; the emulated phone numbers below are the ones that matter.

**Emulated Pixel 7** (4x CPU, 1.6 Mbps / 150 ms RTT, cold cache, medians of 3-5 runs) on the real artifact: static weight 1.71 MB raw / 550 KB gzip / 434 KB brotli (the network is 724 KB raw, 256 KB gzip); DOMContentLoaded 1.8 s; usable (data fetched, verified, router initialised) 6.6 s; an 8.5-mile point-to-point plan 0.93 s; a 5-mile loop 1.6 s and a 10-mile loop 4.0 s. Emulator numbers only; no physical device.

**Synthetic package** (`tests/support/county-fixture.mjs`, the real file formats with real digests): admission/drift/authentication/atomic-write unit tests; runtime parse/verify tests including damaged omission metadata; county provenance/audit tests; the county-mode browser suite (`npm run test:county`, desktop + Pixel 7): packaged load, identity in storage and across a reload, unchanged/removed/now-proposed/moved/ineligible/legacy saved routes, restored ride, stale-route export refused in both privacy modes, planned-on versus checked-against identity in exports, worker restart on changed and on withdrawn data, missing/corrupt/incompatible/unapproved data with Retry recovery and no fixture fallback, disconnected destination, loop, and artifact headers and provenance; and the bridge JVM+JS revalidation tests, including the cache-collision and connector regressions.

## What is not done

- Physical iPhone Safari / Android Chrome runs (#41) and field validation (#18): every timing above is an emulator number, and whether the 21-part network is acceptable for riders (the largest part is 88% of the trails, but downtown gaps need street data) is a product decision for the owner.
- Street access and the unresolved 16:69 / 16:1773 join are not explored beyond the numbers above.
- Owner approval of this source composition, hosting, basemap and sign-in decisions, Firebase/sign-in/sync (#31 beyond this slice, #32, #33), and any public release. The dataset stays `approved: false` with five listed blockers.

## Rollback

The dataset is content-addressed: `data/dataset.json` is served `no-cache` and points at an immutable `trails.<sha12>.json`. Rolling back is redeploying the previous artifact (or previous `dataset.json` with its network file still hosted). Saved routes recorded against the newer data are re-checked against the older data on the next open and either pass or show the recalculate action. A build never overwrites an older network file, because the name is its hash.
