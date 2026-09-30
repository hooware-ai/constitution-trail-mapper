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

- a feature not in the manifest, missing, or duplicated;
- a feature that is no longer `Existing`, or from a layer other than the one licensed layer (8);
- geometry or attribute evidence hashes, routing roles, source URL, license or license URL, review date;
- missing attribution, license evidence or change disclosure; invalid or non-finite geometry;
- any of the six omitted proposed ids (54:1929, 54:1952, 54:2349, 54:3824, 54:4275, 54:4772) or an OSM/supplement layer.

Output is deterministic for the same inputs. The package is written to `webApp/generated/county/` (ignored) by staging in a sibling directory and renaming, so a failed or interrupted run leaves no half-written package.

Nothing is widened or connected: no OSM supplements, no street access graph, no manufactured connections. Routes exist only where the reviewed trails themselves meet, and a missing connection is never treated as usable.

## Commands (an authorized person runs the first; nothing here contacts a server)

    python tools/fetch-web-review-data.py          # repo root; the extractor, needs network access to the licensed service
    cd webApp
    npm run package:dataset                        # admission + packaging into generated/county
    TRAIL_DATASET=county npm run build             # PowerShell: $env:TRAIL_DATASET="county"; npm run build
    npm run release:check -- --dataset county      # full clean-source check with the county build

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

Every inspection, navigation start, position evaluation and ride restore is checked by the shared Kotlin bridge against the network loaded now, per edge: the feature still exists (by its canonical id), keeps its status, is still eligible under the route's own layer choices, and still lies along the same geometry (sampled every 25 m, 2 m tolerance). A route that was `Existing` when saved but is `Proposed` now fails. Routes with no feature identities (saved before this change) are `unverifiable` outside the fixture. Results:

- **current**: proceeds exactly as before (closures and access warnings still apply);
- **stale / unverifiable**: the route and its geometry are **preserved**, shown with the specific changes and a "Recalculate on current data" action; `canNavigate` is false, **Start is disabled**, a position evaluation is refused, and a restored ride is **not resumed**. Recalculation replaces the route only when the rider asks (with the existing undo).

Proposed trails stay opt-in; a stale check never turns one on.

## Verification performed on synthetic data

There is no licensed extract in this checkout and contacting the county service is out of scope, so **no real-data artifact exists yet** and the following ran on a _synthetic_ package built in the real file formats (`tests/support/county-fixture.mjs`): admission, drift and atomic-write unit tests; runtime parse/verify tests; county provenance/audit tests; the county-mode browser suite (`npm run test:county`, desktop + Pixel 7): packaged load, identity in storage, unchanged/removed/now-proposed/moved/ineligible/legacy saved routes, restored ride, missing/corrupt/incompatible/unapproved data with Retry recovery and no fixture fallback across reload and worker restart, disconnected destination, loop, and export provenance; the artifact-level headers/provenance checks; and the bridge JVM+JS revalidation tests.

Emulated-mobile sizing on a synthetic 254-feature lattice (419 KB network, ~40 vertices per feature) with the same Pixel 7 / 4x CPU / 1.6 Mbps profile as [hosting-runbook.md](hosting-runbook.md): static weight 1.40 MB raw / 282 KB brotli; DOMContentLoaded 1.8 s; usable (data fetched, verified, router initialised) 5.1 s; first 10-hop point-to-point plan 0.42 s (medians of 5). These size the loading path; they are **not county numbers** and not device measurements.

## What is not done

- The real 254-feature package: it needs the private extract, which an authorized person must produce with the extractor. If the extract has drifted from the reviewed manifest, packaging fails with the exact reason and nothing ships.
- Real-data route cases (point-to-point, loops, disconnected areas, closures on real geometry) and real-data mobile timing: blocked on the above; the synthetic runs do not stand in for them. The county's connectivity and coverage limits (which of the 254 features actually join, how much of Bloomington–Normal is reachable without street access) are unmeasured until the real package exists.
- Physical iPhone Safari / Android Chrome runs (#41) and field validation (#18).
- Firebase, sign-in and sync (#31 beyond this slice, #32, #33), hosting, basemap and provider decisions, owner approval and any public release.

## Rollback

The dataset is content-addressed: `data/dataset.json` is served `no-cache` and points at an immutable `trails.<sha12>.json`. Rolling back is redeploying the previous artifact (or previous `dataset.json` with its network file still hosted). Saved routes recorded against the newer data are re-checked against the older data on the next open and either pass or show the recalculate action. A build never overwrites an older network file, because the name is its hash.
