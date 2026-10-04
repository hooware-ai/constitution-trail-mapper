# Address index prototype and inert hosting stager (UNAPPROVED; chooser integration is opt-in per build)

Recorded 2026-10-03 in the local release-candidate worktree (`codex/web-release-candidate`). **This approves nothing, publishes nothing and changes no app behavior.** Nothing in `webApp/src` imports the prototype (a unit test pins that), no generated address file is committed, and nothing here is a rights, owner, hosting or public-release decision. Committed approval stays `approved: false`, `approvedComposition: null`, approver and date null; every rights, data, device, hosting and public blocker is unchanged. Start and the estimated-gap rule are untouched.

## What an address point is, and is not

The county's address point says where the county records an address. It is **not an approved trail entrance** and has no connection to the trail network. Anything that used it to place a trip would still meet the existing rules: mapped access, estimated gaps that block Start, closures. The prototype only helps a rider **find or label a place**; the reverse label names the nearest address point and does not say a point is an entrance.

## Source (primary metadata, checked 2026-10-03)

| Item | Value |
| --- | --- |
| ArcGIS item | `502eefa828f94f749bbab9da63b0d016`, "Addresses", Feature Service, public, owner `crystal.williams`, created 2017-02-17, **modified 2022-09-06** (tags: addresses, McLean County, OpenData). Its `url` is the service layer below. |
| Service layer | `https://www.mcgisweb.org/mcgc/rest/services/OpenData/OpenData/MapServer/0` ("Address"; `maxRecordCount` 2000) |
| License | the item's `licenseInfo` states **Creative Commons Attribution 4.0 International** (https://creativecommons.org/licenses/by/4.0/). The fetcher re-checks that text, requires `item.url` to equal the pinned service URL (a reproducibility guard: the statement applies to the item, so the item and the queried layer must be the same thing), stops if either fails, and keeps the original response bytes: `release-candidate-logs/address-index/source-item-metadata.json` and `source-layer-metadata.json` (hashes in the fetch manifest and the pin). The pin carries the item's `licenseInfo` verbatim, not stock wording. |
| Access used | public, unauthenticated, read-only GET queries only: no account, no token, no terms accepted, no OAuth, no paid mode, no write. |
| Fields requested | `OBJECTID_1, ADDRESS, Building, Unit, Post_Comm, Post_Code, Inc_Muni, County, State` and the point. Not requested: staff user and edit-date fields, or any owner or property data. No personal route, position or typed text is involved. |
| Attribution and changes (carried in the pin manifest) | "Contains McLean County, Illinois address data from the county's public 'Addresses' ArcGIS item, licensed CC BY 4.0 ... not the county's own product and not endorsed by the county", plus the list of changes made: fields reduced, text normalized, points rounded to 1e-6 degrees, rows outside McLean County, without a number, without a point, or exact duplicates removed. |

Staleness: the item says it was last modified in 2022; whether the service rows are newer is **not established**. A later use must decide how current an address list has to be.

Reproducibility: the whole fetch was repeated on 2026-10-03 (second run, after the review corrections below, to capture the source metadata): the raw bytes were identical (same SHA-256), so the rows did not change between the two runs; that is all it shows.

## Completeness (no biased first-1000 claim)

`webApp/tools/fetch-mcgis-addresses.mjs` takes the total from a count query and the id range from min/max statistics, then fetches in `OBJECTID_1` windows of 1,500 ids (below the 2,000-record limit) and fails the run if any window reports `exceededTransferLimit` or if rows, distinct ids and the service count differ.

| Check | Result |
| --- | --- |
| Service count / fetched rows / distinct ids | **85,220 / 85,220 / 85,220** |
| `OBJECTID_1` range, windows | 1..202,800 (sparse ids), 136 windows, **no transfer limit hit** |
| Rows without a point | 0 |
| Raw (ignored) file | 10,805,388 bytes, SHA-256 `428e2c921afd011cc64e553b301946806e4af582090f0cb3ea3b1783ca6cd7cf`, retrieved 2026-10-03T23:56:03Z |
| By `County` | McLean 85,216; Woodford 3; Livingston 1 |

Gaps stated plainly: completeness is relative to what the service returned on that day. The service count is the only independent total; there is no second source to reconcile it against.

## Transform and the index

`webApp/src/addressIndex.ts` (pure TypeScript: no network, storage, timers, DOM or globals; nothing can upload typed text or positions) and `webApp/tools/build-address-index.mts` (offline builder).

- Normalization: upper case, punctuation dropped, directionals and street types mapped to one form (`NORTH`/`N`, `STREET`/`ST`, `AVENUE`/`AVE`, ...), applied to the source and to typed text alike. A leading house number keeps its suffix (`12A`, `12 1/2`, `12-5`); `12A` is not `12`.
- Index: parallel columns sorted by street, number, suffix, unit, city, id; street names listed once with offsets; points delta-encoded in 1e-6 degrees; object ids kept as provenance. Deterministic: the builder re-runs on reversed input and fails unless the bytes are identical.
- Built rows: **85,075 indexed** of 85,220: 4 not McLean, 4 without a house number, 137 exact duplicates (same address, unit and point) dropped. Points that differ are kept, because two points for one address is the ambiguity a rider should be told about. 3,284 streets, 37 postal communities, 22,001 entries carry a unit or building label.

| Size | Bytes |
| --- | --- |
| Raw county extract (ignored) | 10,805,388 |
| Index JSON | **2,363,849** |
| gzip -9 | **630,275** |
| brotli q11 | **501,629** |

Index SHA-256 `ef5c386736f099c01a1116b8f09ab85f4115815a23157de339c12eaf4f9cdc4f`. Inputs and the transform are pinned in `data/web-address-index.manifest.json` (a pin only, like the other manifests: not an approval).

Timings, Node 24.13 on this development machine, **not a phone**: build 225 ms; parse and decode 15 ms; search median 0.15 ms, p95 about 1 ms (20 rounds of 10 queries including misses); reverse label median 0.007 ms, p95 0.03 ms, first call 3.8 ms because it builds the 0.002-degree grid. Load on a phone, and shipping a 0.5 to 0.6 MB compressed file against the app's current payload, are open questions this prototype does not answer.

## Search behavior

| Typed | Result |
| --- | --- |
| exact number and street, one place | `matches`, `ambiguous: false` |
| same number and street in several postal communities (`421 n main` gives Bloomington and ISU; `100 main` gives four) | `matches`, `ambiguous: true`: all listed, never merged or guessed |
| several units at one number recorded at one identical point | one place; the unit labels are listed |
| number not on the street (`2210 Stone Mountain Blvd`) | `nearest-numbers`: the numbers either side, no point invented |
| the same address recorded at two different points (about 4% of addresses: 2,523 of 63,788 address groups; 197 of them spread over 50 m, 5 over 500 m, the widest 996 m) | separate places, `ambiguous: true`, each with its own point; unit labels are grouped only at one identical recorded point; no location is guessed |
| a street type typed in part (`421 n main stre`, `7 oak aven`) | matches: the last token also matches the canonical alias it begins (STRE gives ST), by equality, so it never widens into other names such as `Main Stone Rd` |
| number not found and several streets of that name (`99999 main st`) | the street list, no "nearest" |
| street only (`main`) | `streets` list |
| unknown street, empty text, number only, or an abbreviation not in the table (`stone mtn`) | `none` |
| a leading directional left out (`901 hershey` finds `901 N Hershey Rd`) | `matches` |

Reverse label: the nearest address point within a caller-given bound (default 75 m; reach is computed from the bound on both axes and the bound is capped at 2,000 m so the call cannot become a county scan), with its distance, or `null` so the caller keeps its existing label.

## Six catalog places compared (`release-candidate-logs/address-index/catalog-comparison.json`)

| Catalog place and typed address | Index result | Distance from the reviewed catalog marker |
| --- | --- | --- |
| Tipton Park north entrance, 2201 Stone Mountain Boulevard | `2201 Stone Mountain Blvd, Bloomington` | 50 m. The county park point says 2210; the address layer has **no** 2210 (it reports 2201 and 2303 as neighbors). |
| Culver's Hershey Road, 901 Hershey Road | `901 N Hershey Rd, Bloomington` (directional absent from the typed text) | 1 m |
| Culver's West Market, 1807 W. Market Street | `1807 W Market St, Bloomington` | 3 m |
| Normal Public Library, 206 W. College Ave. | `206 W College Ave, Normal` (1 unit label) | 10 m |
| Fairview Park, 801 North Main Street | **ambiguous**: six points: Bloomington (3.9 km, two points), Normal (49 m, 129 m, 146 m), Saybrook (40.9 km) | the nearest is the right one; without a city a rider is shown them all |
| Miller Park, 1020 South Morris Avenue | **ambiguous**: eight recorded points for the one address, 123 m to 231 m from the marker (one without a unit label, seven with one); this was shown as a single place before the review correction | a building point, not the park entrance; no reverse label inside 75 m |

The current catalog search (`searchPlaces`) finds all six by their labels and addresses; the index adds addresses that are not in the six-place catalog. Reverse label at each marker: Tipton, Hershey, West Market and the library name those same address points (50, 1.3, 3.1, 10.3 m); Fairview names `514 Mckinley St, Normal` (35 m), which shows that the nearest address is a nearby label, not the place; Miller Park has none within 75 m.

## Controls (unit tests, synthetic rows only)

`tests/unit/address-index.test.ts`: normalization; determinism and order independence; a report for every exclusion; the same number in two cities stays ambiguous; the same address at two recorded points stays ambiguous and units group only at one point; partly typed street types and no widening; the reverse bound on both axes, below the cap and capped; units grouped; suffix is part of the number; missing number gives neighbors only; no-match, empty and number-only queries; non-county, no-number and no-point rows skipped; reverse label bound, tie-breaking and "county-address-point, never an entrance"; source scan proving no network, storage, timer, DOM or global use and no imports; and that no app source imports the module.

## Inert HTTPS staging (`webApp/tools/stage-hosting.mjs`, `tools/lib/stage-hosting.mjs`)

Prepares what a host would serve, without choosing one. It verifies the artifact with the existing provenance check, applies the existing `hosting/headers.mjs` policy (not a second copy), copies the exact verified files into a local directory, and writes `stage-manifest.json` (per file: size, SHA-256, content type, cache control; the security headers every response needs; the artifact's recomputed public-release verdict, copied and never decided). It refuses a modified artifact, a staging directory inside the artifact, a non-empty directory it did not write, an unknown content type, an unhashed `assets/` file, and (with `--public`) any artifact not eligible for public release.

It has **no host, account, credential, upload or network code** (a test scans for them). The local tests (`tests/unit/stage-hosting.test.ts`) use a synthetic fixture artifact; the fixture is correctly reported not publishable. Policy gap recorded, not changed: `cacheControlFor` makes only `trails.<hash>.json` immutable, so a future hash-named data file such as an address index would revalidate on every load until that policy is deliberately extended in its own reviewed change.

## Review corrections (TM-LOCAL-PREP-7c675b5-20261004-01)

Three synthetic probes from the review were reproduced, fixed and pinned by tests that fail on the previous module (checked by running the new tests against it): (1) grouping now includes the recorded point, so two points for one address are two places; (2) the last typed token also matches the canonical form of any alias it begins; (3) the reverse lookup computes its cell reach from the bound on each axis (the latitude reach was fixed at one cell, so a point 445 m north was missed at a 500 m bound) and caps the bound at 2,000 m. The transform is unchanged: the raw hash `428e2c92...` and the index hash `ef5c3867...` are identical to the first checkpoint.

## Not established

- Any Trail Mapper owner approval to ship this index (an internal composition decision, separate from the source's CC BY 4.0 label, whose attribution and change statement a shipped build must carry).
- Availability and rate tolerance of the county service for repeated bulk queries: an operational unknown, not a claim that any permission is missing for the already downloaded, CC BY-labelled bytes.
- Currency of the data (the item was modified 2022-09-06), accuracy of any point, or fitness of any address as a trip start or end.
- Phone load time and memory; the effect on payload and caching; how a future UI would present ambiguity.
- Anything about native parity: native has no address search here, and this adds none to the app.
- A deterministic native-order packaging seam for the trail network (separate, recorded in [first-public-nonproposed-proof.md](first-public-nonproposed-proof.md)); it is not applied here.

## Reproduce

    cd webApp
    node tools/fetch-mcgis-addresses.mjs          # read-only public queries; ignored raw output
    npx tsx tools/build-address-index.mts --manifest ../data/web-address-index.manifest.json
    npx tsx tools/compare-address-catalog.mts
    npx tsx --test tests/unit/address-index.test.ts tests/unit/stage-hosting.test.ts

## Update 2026-10-04: place chooser integration (local, opt-in)

The start and destination `PlaceChooser` now offers county address results, from the same `addressIndex.ts` and the pinned index in `data/web-address-index.manifest.json`:

- **On demand only.** Nothing loads at start-up. The index file is fetched once, when the rider types a house number plus street text (`looksLikeAddress`); the request is for a fixed file, so typed text never leaves the device, and the file's SHA-256 is checked when the build records one. A failure says so and every other way to choose (saved places, the six public places, current location, map picker) still works.
- **Distinct points stay distinct.** The same address recorded at different points (or in different postal communities) is several selectable choices, each showing city and postal code, unit labels, "Point n of m", its coordinates and, when a start exists, its distance from it, under an ambiguity notice. A missing house number offers only the nearest numbers and says they are not the typed address.
- **Honest label, no snapping.** Every result says "County address point · not a verified trail entrance". The chosen endpoint is exactly the recorded point; nothing snaps it to a trail, and the routing core's estimated-connection and closure rules apply unchanged, so an address far from a mapped trail still shows its measured unverified connection and Start stays blocked.
- **Not in a default build.** The index is added to a build only when `TRAIL_ADDRESS_INDEX_FILE` names a file, only in the review channel, and only if its bytes equal the pinned index (a public-channel build, or any other file, refuses). Without it the chooser says address search is not available in this build. Review fixtures read a synthetic index from `data/address-index.fixture.json`, which the tests serve from memory; a county build never asks for that path. The real generated index is ignored and uncommitted, and nothing here approves the index or any composition.
- **Tests:** `tests/unit/address-search.test.ts` and `tests/e2e/address-chooser.spec.ts` (synthetic rows only): lazy load, two distinct ambiguous choices for start and destination, an address endpoint 365 ft from a trail keeping its connection and a disabled Start, failure fallback.
