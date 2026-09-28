# Maps and local cycling updates integrated into Trail Mapper

Reviewed September 7, 2026, Central time. Android version 0.2.0 (version code 2).

## Map decision and link audit

Keep the [official county GIS map](https://mcleangis.maps.arcgis.com/apps/instant/sidebar/index.html?appid=d98c151296fd4b03860af8f4df7787a4) and supplement its geometry in the app. Friends of Constitution Trail still identifies that map as its newest map. No replacement county trail app was found. The app's 260 county features match a fresh September 7 extraction exactly.

The existing links were not confirmed broken, but their labels and coverage were insufficient. Some Bloomington pages reject automated HTTP requests even though their published pages remain discoverable; an HTTP 403 alone was not treated as a dead link. The resource catalog now distinguishes the latest county map, live official closure sources, project status, Bloomington rules, Normal rules, and the January 2027 state law.

The [regional printable brochure](https://www.constitutiontrail.org/_files/ugd/05629c_44a060ef89384409a6858e66a02a2cac.pdf) is still **June 2022**. Its ArcGIS item was modified in March 2026, but its content remains the 2022 edition. A genuinely newer local map is [Heartland's August 2026 campus map](https://www.heartland.edu/documents/about/hccCampusMap.pdf). Both editions are explicitly labeled in the guide.

## What changed

- **Android trail overview:** Home → Trail Mapper map displays existing county trails, park paths, shared roads and verified additions separately. Proposed paths default off and appear only as a clearly labeled dashed preview. Map controls and camera survive rotation; controls scroll in landscape. Official county map and source attribution remain accessible.
- **Four verified path additions:** the roughly 114-meter Morris/Veterans–Greenwood multiuse path and three existing COUNTRY Financial/Birky Pond ways now participate in the map and routing. A separate provenance manifest pins OSM way versions, coordinate hashes, access tags and official opening sources. The county base asset is unchanged.
- **Local updates and rules:** Home, navigation drawer and both planners link to a dated guide covering conditions, completed/future projects, jurisdiction-specific rules and maps. January 2027 requirements remain upcoming until their effective date. Estimated completion dates never silently mark closures or proposals open.
- **Hamilton/Rhodes advisory:** matching ordinary-road portions of new or saved routes show a warning in route results and on the route map. The map shows only the approximate official work corridor, with explicit labeling. The full notice survives rotation, refreshes its date wording on resume and links to official sources.
- **Route sharing:** matching PNGs get a measured warning footer below the complete map; image captions and fallback text retain the warning and source URL. Unaffected routes retain their existing output.
- **Data refresh robustness:** normalized JSON accepts a leading UTF-8 BOM, preserving compatibility with Windows PowerShell refresh scripts. Android builds fail early if the county or reviewed-additions asset is missing. README and the routing data plan document the refresh commands and review procedure.

## Practical limits

- County data freshness does not establish complete physical coverage. Precise geometry remains missing for the Birky Pond connection to the Raab Road trail and the short Stone Roller Circle–Benjamin School connector. The app records those gaps and does not manufacture graph connections. Existing estimated endpoint-access behavior still applies separately.
- Hamilton's city notice identifies 512–519 E. Hamilton Road, while the county work line spans a much broader corridor. It cannot safely be treated as exact barrier geometry. The feature warns riders and explicitly says the route has **not** been automatically detoured. It does not mark the parallel trail closed or guarantee current passage.
- The guide and overlays are reviewed bundled data, not a live closure feed. Links open current official publications; opening a link does not refresh bundled route geometry. An estimated reopening date does not remove the warning.
- Future West Normal, Veterans, Uptown, Lafayette/Hamilton and Chenoa projects were not promoted to existing routable infrastructure. Existing proposed-layer behavior remains opt-in.
- Shared iOS code compiles; this release's native trail overview and device validation are Android-specific.
- The earlier two navigation regressions and one constrained route-search regression remain documented and skipped. This map/content update does not claim to fix them.

## Validation

The final integrated Gradle run passed shared and Android unit tests, Android assembly/lint, and iOS device/simulator Kotlin compilation: **295 passed, 3 known regressions skipped, 0 failures or errors**. Three Python extraction safety tests also passed. Real-data tests confirm the Morris path connects to the existing Route 66 network and that Birky Pond supports a local exercise route without inventing a Raab Road graph connection.

Emulator validation covers overview rendering, proposed-off default, map-layer state across rotation, guide categories and rule state across rotation, Hamilton route warning/dialog and rotation, and the shared image footer. The final APK also generated the 1.83-mile ordinary route from Evans Street to Fell Avenue after rotating during point selection; both endpoints remained intact after visiting the new guide and returning to the planner. A synthetic Hamilton QA record was used only in emulator storage; original records were backed up, restored and re-read. No recipient was selected in the share sheet, and the fixture was not installed on the phone. The test emulator was shut down after verification.

Version **0.2.0/code 2** was installed and launched on an Android device. The installed APK SHA-256 matched the tested local APK: `7da1927261404cdf5117c0e3787ad07ccbc78097c0ffc8e7aa917cf575ed818d`. The installed archive contains all 260 county features and four supplemental features.

Evidence: `artifacts/map-integration-2026-09-07/`, including `coverage-audit.md`, `validation-final.log`, `test-totals.json`, screenshots, UI snapshots and device receipts. Research details remain in `docs/local-cycling-updates-2026-09-07.md` and `docs/hamilton-closure-mapping-2026-09-07.md`.

## Main implementation files

- `shared/.../LocalTrailGuide.kt`, `LocalTrailGuideScreen.kt`, `TrailRouteAdvisoryBanner.kt`, `App.kt`, `TrailMapperNavigationDrawer.kt`
- `shared/.../routing/TrailRouteAdvisorySijko.kt`, `NormalizedTrailNetworkJsonSijko.kt`
- `shared/.../sijko/TrailResourceLinksSijko.kt`, `TrailMapperAboutSourceLinksSijko.kt`, `SavedTrailRouteShareTextSijko.kt`
- `androidApp/.../map/TrailNetworkOverviewActivity.kt`, `TrailRouteMapActivity.kt`
- `androidApp/.../routing/AndroidTrailNetworkProvider.kt`, `AndroidTrailRouteShareImageComposer.kt`
- `data/verified-trail-additions.manifest.json`, `tools/fetch-verified-trail-additions.py`, `data/generated/verified-trail-additions.normalized.json`
