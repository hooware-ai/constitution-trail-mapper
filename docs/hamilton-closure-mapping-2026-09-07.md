# Hamilton/Rhodes closure mapping

Checked September 7, 2026. The city reports an all-traffic closure between **512 and 519 E. Hamilton Road**, beginning August 17. September 30 is an **estimated** construction completion date, not a verified reopening. [City notice](https://www.bloomingtonil.gov/Home/Components/News/News/10909/1394).

## Geometry and source limitations

Both the [city road-closures page](https://www.bloomingtonil.gov/departments/engineering/bloomington-streets/road-closures) and [county construction page](https://www.mcleancountyil.gov/319/Road-Closures-Construction-Map) link the same [current construction map](https://experience.arcgis.com/experience/09937d80e7b8421e94fff9af03237b32/). Its web map is `23f9422a3d8b4d2ebff5d7be8a7304af`.

[Public closure-layer object 841](https://services3.arcgis.com/ZntpsilxOye7y1YF/arcgis/rest/services/RoadClosures_public_7e10ca6b3d3a4e6fa88caf9918ade300/FeatureServer/1/query?objectIds=841&outFields=*&outSR=4326&f=json) corroborates the Hamilton/Rhodes closure and dates. It was edited August 26. Its two-point geometry covers roughly 1.24 km of the Bunn Street–Morrissey Drive corridor:

| Endpoint | Latitude | Longitude |
| --- | --- | --- |
| West | 40.4512277313916 | -88.9813226624867 |
| East | 40.4513485856116 | -88.9667059346487 |

That line is broader than the address interval in the city notice. The official address-point layer places 512 and 519 roughly 108 m apart along the road's east/west axis; these are building locations, not surveyed driveway entrances or barriers. Using them to invent exact closure limits would add unsupported precision. [Address-point query](https://www.mcgisweb.org/mcgc/rest/services/McGIS_Viewer/Layers/MapServer/22/query?where=ADDRESS%20IN%20%28%27512%20E%20HAMILTON%20RD%27%2C%20%27519%20E%20HAMILTON%20RD%27%29&outFields=OBJECTID_1,ADDRESS&outSR=4326&f=json).

The bundled access network includes this corridor as `8:2368212` (`W Hamilton Rd`, despite the city notice's east address) and overlapping `8:3333226` (`Rhodes Ln`). Removing both full features would also suppress permitted local access outside the short closure. A broad geographic filter could wrongly suppress a parallel trail.

## App treatment

- Keep the base network unchanged; do not manufacture blocked edges from approximate geometry.
- Show the published line as an **approximate work corridor**, explicitly distinct from exact closure limits.
- Warn when a new or saved route uses a named, routed Hamilton/Rhodes road-access portion near that corridor. A 25 m matching tolerance accommodates the approximate official line's offset from the bundled road centerline; it is a warning trigger, not a claimed closure boundary.
- Support older saved routes using the known source IDs when segment names are missing.
- Do not mark a parallel trail, an unrelated road, an estimated straight connector, or the separate Hamilton alignment north of this corridor closed.
- Explain that the route has not been automatically detoured. Provide the city notice and latest construction map.
- Include the relevant warning and notice URL in shared text, image captions, and a measured footer below exported route maps. Unaffected routes retain their existing share output; the warning does not cover basemap attribution.
- Retain the last-checked date. After September 30, state that reopening remains unconfirmed; do not infer an all-clear from an estimated end date.

Hershey construction and intermittent storm work remain separate advisories. The GIS contains lane-impact records that are broader than newer written notices; automatically converting every `All Lanes` record into a bicycle prohibition would be unreliable.

## Evidence and checks

Shared implementation: `TrailRouteAdvisorySijko`, `TrailRouteAdvisory`, and `TrailRouteAdvisoryCorridor`. Focused tests exercise route preservation, persisted-route recognition, unaffected parallel trails and other roads, time boundaries, and approximate-overlay labeling.

The official GIS timestamps convert to August 17 at 7 a.m. CDT and September 30 at 6 p.m. CDT. The latter controls only the change to explicit post-estimate uncertainty; it never marks the road reopened.

Local source receipts are under `artifacts/cycling-news-2026-09-07/`: `hamilton-closure-evidence.json`, `hamilton-address-points.json`, `construction-app.json`, `construction-webmap.json`, and `construction-layer-1.json`.
