# Fresh endpoint-road source review

`python tools/fetch-web-access-road-review.py` captures the original public TIGERweb layer 8 and Overpass `highway=service` queries. Bounds remain `[-89.2, 40.4, -88.9, 40.6]`; TIGER classes and OSM access/service exclusions remain those in the native extractor. This command does not admit data or approve publication.

Raw responses, queries, HTTP metadata, capture times, SHA-256 identities, tool snapshots and version information stay under ignored `data/generated/access-review-<UTC>/`. The tool requires its execution tools and deterministic transform to be committed and unchanged. Native extraction and serialization files must match HEAD. Count/ID snapshots bracket TIGER pagination; the complete ordered page IDs must match both snapshots. Geometry and every normalized record are independently checked against the responses. WGS84 coordinates and intersection with the selected bounds are required; full intersecting geometry is retained, without clipping.

The unchanged native extractor runs offline against the captured responses. A response-completion timestamp replaces replay time. Canonical web-review serialization sorts object keys while preserving all array order and values, because the native `sources` hashtable has nondeterministic key order. The reviewed input SHA is the canonical web file, not the native extractor's raw serialization. The native extractor/history remain intact.

For another independent audit without another source request:

```sh
python tools/fetch-web-access-road-review.py --responses-from data/generated/access-review-<UTC>
```

This requires a completed capture, verifies raw response byte counts/hashes and exact query identities, and requires the same ordered responses, response-completion timestamp, native extractor and normalized-file SHA. A review-tool revision may change only with explicit old/new provenance recorded; it cannot substitute different data. Failed audits are labelled failed and remove their normalized output. Direct PowerShell replay is only extraction, never source admission.

After review, the committed source manifest must retain the earlier source identity/history and add a fresh review entry. Merely replacing a hash is insufficient. The packager's source, transform, composition and publication guards remain separate. `approved` remains false, public publication remains blocked and attribution remains required.

## Comparison and limitations

`node webApp/tools/compare-access-review.mjs <fresh-input> <v5-dist-data-directory> <report>` requires the successful capture's exact input and tool hashes. It verifies the independently recorded v5 base/index and every tile, reconstructs original feature order, and reports TIGER and OSM changes plus deterministic part hashes. It compares router-visible geometry/name/class/order. The unavailable old raw file's access tags, timestamps and raw-byte equivalence remain unverified.

Overpass response order is intentionally preserved, rather than assumed sorted or changed. A response's `osm3s.timestamp_osm_base` identifies its database snapshot; it is not a per-way edit timestamp. TIGER before/after IDs prove selection membership, not that every feature was unchanged during the capture interval. No atomic cross-source snapshot is claimed.

The original exclusion policy admits some conditional/restricted tags such as `access=customers`, `destination` or `permit`; it does not establish public access rights. This review preserves that policy and endpoint-only 600 m routing purpose. ODbL/combined-database questions and public redistribution approval remain unresolved. Fixture and mobile-emulation tests cannot establish physical GPS or field access acceptance.

## Production routing verification

After packaging the reviewed county trails, four reviewed OSM trail additions and the fresh access source:

```sh
cd webApp
npx tsx tools/verify-access-review-routing.mts <fresh-input> <v5-dist-data-directory> <report.json>
```

This uses the real shared Kotlin router and production hash-verifying `AccessLoader`/`AccessSession`. Every tested response must equal the complete fresh-source control. County/OSM endpoint plans and the three-mile loop must produce routes; fresh cold sessions revalidate those routes and three saved routes planned on verified v5 derived roads. Willow closure activation, its still-active state beyond the estimated end, resumed-ride refusal and recalculation are compared. The reviewed loop's actual estimated gap must block ordinary navigation; an endpoint outside coverage must yield no route. These narrow cases do not establish all-route equivalence or field acceptance.
