<!--
Job: Record the official trail-map data sources, extraction shape, and routing-graph approach for Trail Mapper.

-->

# Routing Data Plan

Trail Mapper should route on the mapped trail network itself, not on the general road graph. Ordinary roads should enter a route only as short access legs between an address/map point and the approved trail network.

## Source Chain

The official Trail Maps page from Friends of the Constitution Trail links to two map products:

- Constitution Trail GIS Map: `https://mcleangis.maps.arcgis.com/apps/instant/sidebar/index.html?appid=d98c151296fd4b03860af8f4df7787a4`
- Constitution Trail PDF Map: `https://www.constitutiontrail.org/_files/ugd/05629c_44a060ef89384409a6858e66a02a2cac.pdf`

The page describes the GIS map as the most updated map available, so the GIS services behind that map should be the working source of truth. The ArcGIS app item points to web map `7470738236b04a66893f13ecbcd9fe05`, which includes these route-relevant operational layers:

| Layer | ArcGIS REST URL | Use |
|---|---|---|
| Constitution Trail Branches | `https://www.mcgisweb.org/mcgc/rest/services/Recreation/Trails/MapServer/54` | Primary Constitution Trail branches and Route 66 segments. |
| Other Trails | `https://www.mcgisweb.org/mcgc/rest/services/Recreation/Trails/MapServer/16` | Park trails, connectors, bike lanes, and shared roadway segments. |

Other map layers such as parks, facilities, and points of interest are useful for display, but not for route graph edges.

Endpoint access uses a separate ordinary-road graph built from U.S. Census TIGERweb streets and endpoint-local OpenStreetMap service roads. This graph is not part of the approved trail route; it only replaces straight start/end access estimates so users stay on mapped local roads, service drives, parking aisles, walkways, alleys, or bike paths until they reach the approved trail/shared-road network.

Current access-road prototype source:

- TIGERweb Transportation `Local Roads` layer: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8`
- TIGER/Line McLean County All Roads catalog page: `https://catalog.data.gov/dataset/tiger-line-shapefile-current-county-mclean-county-il-all-roads`
- OpenStreetMap service-road geometry through Overpass: `https://overpass-api.de/`
- OpenStreetMap copyright and ODbL terms: `https://www.openstreetmap.org/copyright`

## Current Layer Findings

Both route layers are queryable ArcGIS polyline layers. Query with `outSR=4326` to get longitude/latitude coordinates suitable for mobile map/routing code:

```text
/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=json
```

`Constitution Trail Branches` currently returns:

- 65 features, 100 polyline paths, 6,033 coordinates.
- 59 existing features and 6 proposed features.
- 60 features marked `systemname = Constitution Trail`.
- Facility types include `Separated Trail`, `Shared Lane`, and `Urban Trail`.
- Named branches include Bloomer Line, Collegiate, Illinois Central, Interurban, Northtown, Southtown, Route 66, Route 66 - Advanced, and Route 66 - Alternate.

`Other Trails` currently returns:

- 195 features, 385 polyline paths, 9,419 coordinates.
- 195 existing features.
- 74 `Park Trail` features and 121 `Other` features.
- Facility types include `Bike Lane`, `Off-Road Trail`, `Shared Lane`, and `Urban Trail`.
- The map renderer classifies `systemname + activitytype` into 96 `Park Trail and Connectors` features and 99 `Suggested Shared Roadways` features.

Useful fields shared by both layers:

| Field | Meaning |
|---|---|
| `OBJECTID` | Stable source feature id inside the layer. |
| `FACILITYID` | Facility/source identifier when present. |
| `NAME` | Trail or route name; many `Other Trails` rows are blank. |
| `LENGTH` | Published feature length in miles. |
| `SURFTYPE` | Surface domain: paved, unpaved, unknown. |
| `loc` | Level of comfort domain: all ages/abilities through strong/fearless. |
| `status` | Existing or proposed. |
| `facilitytype` | Bike lane, off-road trail, separated trail, shared lane, urban trail, other. |
| `activitytype` | Bikeway, multiuse, or pedestrian. |
| `systemname` | Constitution Trail, COMLARA Trail, Park Trail, or Other. |

## Extraction Approach

Use `tools/fetch-mcgis-trails.ps1` to pull both layers and normalize the ArcGIS feature data into deterministic JSON:

```powershell
.\tools\fetch-mcgis-trails.ps1
```

Default output is ignored at `data/generated/mcgis-trails.normalized.json`. The file is ignored until the app has a confirmed redistribution policy for McLean County GIS data. For local prototypes, the normalized output should carry:

- source app/web-map/layer metadata
- generated timestamp
- source layer id/name/url
- decoded domain labels for status, surface, comfort, facility type, activity type, and system name
- route roles used by Trail Mapper
- original polyline paths as `[[lon, lat], ...]`

### Verified local additions

The September 7, 2026 geometry audit found that the county's current source omits the completed Morris/Veterans-to-Greenwood path and the COUNTRY Financial pond circuit. The app now loads `data/generated/verified-trail-additions.normalized.json` alongside the unchanged county asset.

```powershell
python tools/fetch-verified-trail-additions.py
```

The versioned review manifest at `data/verified-trail-additions.manifest.json` pins four OpenStreetMap way IDs, versions, coordinate hashes and relevant access tags. It records official opening evidence and bicycle-use justification. The extractor retains original paths and OSM/ODbL attribution in a separate asset, refusing unreviewed source changes before replacing the last usable output. This is a reviewed supplement, not a general import of OSM footways or future projects. IDs begin with `verified-osm:way:`; the Morris path uses the trail-branch role and the pond paths use the park-connector role.

For reproducible offline extraction, pass `--source-json path/to/saved-osm-elements.json`. The same manifest checks still apply. Missing Android county or supplement assets fail the build with the extraction commands rather than producing an APK whose route loading fails at runtime.

The Heartland/Raab access connectors and the short Stone Roller/Benjamin connector remain gaps in sufficiently verified routing geometry. No straight connecting lines are invented. Existing county Gregory, Hamilton and Robinson features are retained rather than duplicated. The official interactive county map remains the public regional source; its printable brochure remains the June 2022 edition. Heartland also publishes a newer August 2026 campus map, useful for local reference but not precise vector routing geometry.

Use `tools/fetch-tigerweb-access-roads.ps1` to pull TIGERweb streets and OpenStreetMap service-road geometry for the ordinary-road access graph:

```powershell
.\tools\fetch-tigerweb-access-roads.ps1
```

Default output is ignored at `data/generated/mclean-access-roads.normalized.json`. The prototype bounding box is scoped to Bloomington/Normal. The extractor includes TIGER MTFCC classes `S1400`, `S1640`, `S1710`, `S1730`, `S1780`, and `S1820`, plus OpenStreetMap `highway=service` features. It excludes OSM features marked private, no bicycle access, drive-through, or emergency-only. Android retains the TIGER base graph and filters OSM service features to a 600-meter area around the current start and destination before graph construction. This bounded overlay captures parking-lot and driveway topology without loading the full city service-road graph into memory. Route-map controls visibly credit OpenStreetMap and link to its copyright/ODbL page.

### Refreshing generated assets

`data/generated/` is ignored by Git, so each checkout refreshes its own copies. Proposed cadence:

- **Access roads** (`mclean-access-roads.normalized.json`): refresh monthly and before every release build. OpenStreetMap service roads change continuously: 153 added and 90 removed by name and geometry between July 11 and September 27, 2026. TIGER local roads changed less: two features were added and three removed by name and geometry, while three otherwise unchanged features changed road class. TIGERweb also renumbered nearly every `OBJECTID` between fetches. Ride history is matched by geometry rather than feature id (earlier issue 8), so renumbering alone no longer resets history.
- **County trails and verified additions**: check them at the same time. They matched upstream exactly on September 26, 2026. Refresh when they differ, and review changes to the verified additions against the manifest as described above.

Procedure:

1. Copy the current asset to `tmp/` (ignored) as a backup. Keep it until the new asset has been checked.
2. Run the fetch command. Each fetch writes the new file completely before replacing the old one, so a failed run keeps the previous asset (earlier issue 22). The public Overpass server sometimes rejects requests when busy; retry after a short pause.
3. Compare the new file with the backup: layer feature counts, and features added or removed when matched by name and geometry rather than id.
4. Run `./gradlew :shared:testAndroidHostTest` (the real-data suites use these assets) and `./gradlew :androidApp:assembleDebug`. The build fails if any routing asset is missing (earlier issue 10). Confirm that the APK's `assets/` contains the new file.
5. Spot-check a few endpoints and exercise starts against the backup: route geometry, road access, and history overlap for a route planned on the previous asset.

Refresh log:

| Date | Asset | Change | Checks |
| --- | --- | --- | --- |
| 2026-09-27 | Access roads, replacing the July 11, 2026 fetch | TIGER local roads 3,425 → 3,424. Only 1 old id is still in use. By name and geometry, 2 added and 3 removed; three unchanged geometries on Basil Way and Pepper Pl changed road class from S1400 to S1780, making 5 added and 6 removed when class is included (Basil Way, Pepper Pl, Ginger Trl, Danbury Dr). OSM service roads 9,250 → 9,313: 153 added and 90 removed by name and geometry, 9,241 ids retained. | 334 shared tests pass. All 20 real-data exercise results are identical to the July asset. Central, southeast and Suffolk Way five-mile loops have identical geometry and identical history overlap against a route planned on the July asset. Suffolk Way → central trail route is identical (266 m routed access via Suffolk Way, Matlock Dr, E University Ave and N Fell Ave). The debug APK packages the new asset. |

## Trail Mapper Route Roles

A source feature can have more than one role. Proposed status is separate from the physical role so we can keep proposed trails opt-in while still knowing what kind of segment they would become.

| Role | Source rule |
|---|---|
| `TrailBranches` | Layer 54, regardless of facility type. |
| `ParkConnectors` | Layer 16 renderer class `Park Trail and Connectors`: `activitytype = Multiuse` with `systemname = Park Trail` or `Other`. |
| `SharedRoadways` | Layer 16 renderer class `Suggested Shared Roadways`: `systemname = Other` and `activitytype = Bikeway`; also useful as a weighting role for layer 54 bike-lane/shared-lane features. |
| `ProposedTrails` | Any feature where `status = Proposed`. |

Default routing should include existing `TrailBranches`, `ParkConnectors`, and `SharedRoadways`. `ProposedTrails` must remain disabled unless the user explicitly enables it.

## Routing Graph Approach

1. Fetch and normalize the public route layers.
2. Filter out disabled source features before graph construction:
   - exclude all `status = Proposed` unless proposed trails are enabled
   - exclude any feature with no enabled route role
3. Convert each polyline path into graph edges between consecutive coordinates.
4. Snap near-identical endpoints within a small tolerance, initially 10 to 20 meters.
5. Split crossing or touching polylines so intersections become graph nodes, not just visual overlaps.
6. Compute edge distance from geometry in meters; keep published `LENGTH` as metadata, not as the edge cost.
7. Preserve edge attributes: source layer, object id, route roles, facility type, comfort, surface, status, and name.
8. Snap start/destination points to the nearest enabled graph edge or node.
9. For endpoint access, evaluate multiple nearby trail edge and trail-node candidates by ordinary-road access route distance. Do not choose the entry/exit point by aerial distance alone; a visually closer mid-segment point can be worse than a farther node that is reachable by normal roads. Exception: when the endpoint is already within a short direct-access threshold of an approved trail/shared connector, allow that nearby approved line to compete so the app does not send the user on a long street loop. Direct estimated access is still scored much higher than mapped access so a reasonable road route to an approved connector wins over cutting across unmapped space. Tiny endpoint-to-road or road-to-trail snap gaps inside an otherwise mapped-road access route are tolerated because the TIGER and trail datasets do not share exact vertices.
10. Create ordinary-road access legs only from the input point to the graph and from the graph to the destination. These should be visible only when they follow the ordinary-road access graph, measured separately, and heavily penalized so the router minimizes them.
11. Run Dijkstra or A* over the approved graph plus selected access legs.

Initial edge cost should be distance-first, then adjusted by comfort and access penalties:

```text
cost =
  trailDistanceMeters
  * facilityMultiplier
  * comfortMultiplier
  + ordinaryRoadAccessMeters * accessPenalty
```

Suggested first-pass multipliers:

| Attribute | Multiplier |
|---|---:|
| Off-road, separated, or urban trail | 1.00 |
| Bike lane | 1.15 |
| Shared lane | 1.35 |
| Unknown surface or comfort | 1.10 |
| Experienced bicyclists comfort | 1.35 |
| Strong and fearless comfort | 1.75 |
| Ordinary-road access leg | 8.00 |

The result should report ordinary-road access distance separately so the user can see when a route is mostly trail versus mostly access.

## Implementation Slices

1. Keep the extractor as a tooling step while licensing/redistribution is checked. Done for local prototypes with `tools/fetch-mcgis-trails.ps1`.
2. Add shared common models for normalized trail features and graph edges. Done under `shared/src/commonMain/kotlin/com/trailmapper/shared/routing`.
3. Add Sijkos for feature filtering, graph construction, nearest-network snapping, edge weighting, and constrained route finding. Done with common tests.
4. Add graph-builder tests with tiny fixture polylines that cover endpoint snapping, proposed opt-in filtering, and shared-roadway penalties. First pass done; crossing/intersection splitting is still pending.
5. Wire the route search button to geocode/map-selected endpoints, snap them to the enabled graph, and return a trail-first route summary. Done for map/current-location endpoints; typed-address geocoding is still pending.
6. Preserve drawable route geometry in the shared route result and render it on Android Google Maps. Done for Android with trail polyline styling and camera fitting; iOS map rendering is still pending.
7. Replace straight-line access estimates with real road/sidewalk/bike access routing before drawing access as a path. Done on Android/shared code with a TIGERweb base graph and bounded OpenStreetMap service-road overlays. Straight remainders are still marked as estimated and not drawn as routed polylines.
8. Choose endpoint trail snaps from multiple edge/node candidates by mapped ordinary-road access instead of first choosing the nearest aerial snap and trying to repair it afterward. Done in shared code with regression tests for node-entry selection and short near-direct access to an approved line.

## Built Routing Core

The first shared routing slice is implemented in common Kotlin:

- `TrailFeatureFilterSijko` filters normalized features by `RouteLayerSelection` and keeps proposed trails opt-in.
- `TrailGraphBuilderSijko` converts filtered polyline features into graph nodes and edges, snapping nearby vertices through spatial buckets instead of full graph scans.
- `NearestTrailSnapSijko` projects user points to approved graph edges and can return ranked edge/node snap candidates for access-aware entry selection.
- `TrailEdgeWeightSijko` penalizes shared lanes, lower-comfort segments, unknown attributes, and ordinary access legs.
- `TrailRouteFinderSijko` runs a priority-queue route search over the approved graph plus temporary endpoint access connectors.
- `TrailRoute` now carries drawable `TrailRouteSegment` geometry in addition to distances and edges; segments are typed as trail or ordinary access and mark whether access is routed or estimated so map rendering can style them separately.
- `TrailRouteSummarySijko` formats trail, access, and total mileage for route feedback.
- `TrailRouteAccessRoutingSijko` replaces straight endpoint access estimates with ordinary-road access graph routes where possible.
- `TrailRouteWithAccessFinderSijko` chooses start and destination trail snaps from endpoint access candidates, strongly preferring mapped-road access to approved connectors while keeping short direct access available as a fallback before the main trail route is selected.
- `TrailRouteMapPresenter` provides a shared platform hook for showing a computed route. Android implements it with `TrailRouteMapActivity`, which draws the constrained trail portion in green, routed ordinary access in blue, start/destination markers, and a fitted camera. Any remaining estimated access is counted in the summary but not drawn as a fake path.

Current limitation: graph building snaps nearby vertices but does not yet split polylines at visual crossings where neither source geometry has a vertex.

The Android debug build bundles ignored local prototype data from `data/generated/mcgis-trails.normalized.json` as `assets/mcgis-trails.normalized.json`. `Find Trail Route` is testable when both endpoints were created from the map picker or current-location button. Manually typed addresses still display a prompt because they do not yet have coordinates.

The first on-device route search produced an Android input ANR before eventually returning a route. The fix moved route computation off the UI-thread path, made graph building use spatial buckets, and replaced the O(n^2) route search with a min-heap priority queue.

## Open Questions

- Confirm whether McLean County GIS permits bundling a static copy of the normalized route data in released Android/iOS builds.
- Decide whether `Route 66 - Advanced` and comfort level `Strong and Fearless` should be default-eligible with a high penalty or hidden behind a future advanced-routes setting.
- Decide the maximum acceptable ordinary-road access distance before the app should say no trail-first route is available.
