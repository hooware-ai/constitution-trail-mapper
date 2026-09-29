# Web review data rights

Verified September 28, 2026. This record covers the local web preview's county trail geometry. It is not authorization to publish or deploy the app, and does not assert current access, safety, or county endorsement of computed routes.

## Licensed county source

The official McGIS **Trails** item explicitly applies Creative Commons Attribution 4.0 International (CC BY 4.0) to its linked dataset:

- License evidence: https://www.arcgis.com/sharing/rest/content/items/a2a54b1f94704061abc90686fbc5c220?f=json
- Human-facing item: https://www.arcgis.com/home/item.html?id=a2a54b1f94704061abc90686fbc5c220
- Licensed geometry: https://www.mcgisweb.org/mcgc/rest/services/OpenData/OpenData/MapServer/8
- License and obligations: https://creativecommons.org/licenses/by/4.0/

CC BY 4.0 permits sharing and adapting this material, including commercially, subject to attribution, a license link, indication of changes, and no added restrictions or implied endorsement. Suggested notice:

> Trail data: McLean County GIS Consortium (McGIS) and members, licensed CC BY 4.0. Filtered and normalized by Constitution Trail Mapper.

The license applies to the linked Open Data item. It must not be inferred merely from a public ArcGIS endpoint, an OpenData tag, or blank copyright/license fields.

## Reviewed subset and extraction

Live comparison found exact matches for all **254 existing route features**: 59 from Constitution Trail Branches and 195 from Other Trails. Both geometry and these consumed fields matched: OBJECTID, FACILITYID, NAME, LENGTH, SURFTYPE, loc, facilitytype, activitytype, systemname. The licensed source contains 283 features in total; its other 29 features have not been approved for this web network. It lacks a status field, so importing all its features or assuming all are eligible would be unsafe.

`data/web-reviewed-trails.manifest.json` pins the 254 reviewed IDs, geometry hashes, consumed-attribute hashes, routing roles, and licensed field domains. It contains no geometry. Runtime geometry and displayed attributes come only from the licensed Open Data layer. The following current operational layers are consulted transiently to verify the reviewed existing status, geometry, attributes, and routing roles:

- Branches: https://www.mcgisweb.org/mcgc/rest/services/Recreation/Trails/MapServer/54
- Other trails: https://www.mcgisweb.org/mcgc/rest/services/Recreation/Trails/MapServer/16

Run from the repository root:

```text
python tools/fetch-web-review-data.py
python -m unittest discover -s tools -p test_web_review_data.py
```

The extractor writes only `data/generated/web-licensed-trails.normalized.json` (already ignored by Git). It rechecks the official license, status meanings, source completeness, domains, and every reviewed hash before atomically replacing the previous asset. New features never automatically enter the network. Changed or missing reviewed features fail rather than silently refreshing the manifest or widening the network.

IDs retain the app's canonical `54:OBJECTID` / `16:OBJECTID` form so existing closure rules still match. These are logical routing IDs. `sourceLayerId` and provenance explicitly identify licensed geometry layer 8; the original role-selection layer is recorded separately.

`--source-json PATH` can replay an existing JSON bundle with `licenseItem`, `licensedMetadata`, `licensedQuery`, and `selectionSources` (layer IDs mapping to `metadata` and `query`). All verification still applies. Offline replay verifies the saved evidence, not the current upstream license or trail status. `generatedAtUtc` records normalization time, while `reviewedOn` records manifest review; neither is a source edit date.

## Six proposed segments: unresolved release gate

The current app and web map have blank licenseInfo, and the operational layers name McGIS and members as copyright holders without supplying an explicit redistribution grant:

- App metadata: https://www.arcgis.com/sharing/rest/content/items/d98c151296fd4b03860af8f4df7787a4?f=json
- Map metadata: https://www.arcgis.com/sharing/rest/content/items/7470738236b04a66893f13ecbcd9fe05?f=json

Six proposed branch features have no geometry match in the licensed dataset: OBJECTIDs 1929, 1952, 2349, 3824, 4275, and 4772. This is an unresolved licensing basis, not a determination that redistribution is forbidden. They are omitted entirely from the licensed web output. A public bundle containing them requires an applicable explicit license or permission from the rightsholder, plus a fresh source/provenance review. Proposed infrastructure must remain opt-in even if its redistribution rights are later confirmed.

The old https://www.mcgis.org/License address currently serves the generic Hub site, not a usable licensing agreement. The current site says data is for display/reference and disclaims accuracy. Retain this context and avoid presenting routes as county-certified navigation:

- County GIS overview: https://mcleancountyil.gov/648/GIS
- Current McGIS site content: https://www.arcgis.com/sharing/rest/content/items/a38f80b4e5034bf2986613ac5e8f0bcc/data?f=json

Before public redistribution of this reviewed subset, re-extract from the specifically licensed endpoint, retain the manifest/provenance, and display the CC BY notice, license link, and change disclosure. License compliance does not replace route-access validation or release authorization.

## OpenStreetMap geometry and tile service are separate

OSM geometry is available under ODbL, with attribution. Public use of a derivative database can trigger share-alike and an offer of the database or complete modifications in machine-readable form. Keeping county and OSM source assets separate preserves provenance but does not by itself decide whether a merged routing graph is a derivative database. Before publicly distributing or serving such a merged graph, resolve that classification and source-license compatibility and satisfy applicable ODbL obligations. These rules concern data; they do not automatically license application code under ODbL.

- OSM copyright: https://www.openstreetmap.org/copyright
- ODbL, especially sections 4.4–4.6: https://opendatacommons.org/licenses/odbl/1-0/

The reviewed county extractor includes no OSM geometry. Existing OSM supplements and access-road data keep their own terms.

Standard raster tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` have separate service rules:

- Keep visible linked `© OpenStreetMap contributors` attribution on the map.
- Send a valid browser Referer; do not suppress it with a restrictive referrer policy. Normal browser User-Agent behavior is accepted.
- Honor HTTP caching headers; never force no-cache by default. If cache headers cannot be interpreted, cache for at least seven days.
- No offline download, bulk fetching, tile archives, background prefetch, or headless pan/zoom harvesting. Automated tests should stub tiles or use a basemap-free view.
- Human interactive local viewing is permitted under these rules. Availability is best-effort and access can be withdrawn; a dependable public service needs a provider arrangement appropriate to its usage.

Official current policy: https://operations.osmfoundation.org/policies/tiles/

No public deployment, county contact, or permission request was performed during this review.
