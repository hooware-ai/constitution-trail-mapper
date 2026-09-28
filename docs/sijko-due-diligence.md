# Sijko Due Diligence

Trail Mapper uses a Sijko as a single-purpose Kotlin `object` that is isolated from UI/platform APIs and covered by focused unit tests.

## First Ten Opportunities

| # | Sijko | Existing behavior isolated | Edge cases covered |
|---|-------|----------------------------|--------------------|
| 1 | `RouteEndpointSwapSijko` | Swaps start and destination fields. | Empty endpoint, populated endpoints, endpoint coordinates. |
| 2 | `RouteSearchAvailabilitySijko` | Enables route search only when both endpoint fields contain useful text. | Empty, one missing, whitespace-only, both present. |
| 3 | `AddressPlaceholderVisibilitySijko` | Shows `Address or place` only when an address field is empty and unfocused. | Focused empty, unfocused empty, populated, whitespace text. |
| 4 | `CurrentLocationPromptSijko` | Decides whether the app-level current-location explanation should be shown. | Permission present versus missing. |
| 5 | `ForegroundLocationGrantSijko` | Treats either fine or coarse foreground location as sufficient. | Fine only, coarse only, both, neither. |
| 6 | `CurrentLocationResultMessageSijko` | Converts platform location results to user-facing error text. | Success, denied, services off, unavailable, custom error, blank error. |
| 7 | `CurrentLocationAddressApplySijko` | Writes a resolved current-location address and coordinate to the selected endpoint. | Start, destination, blank resolved address, optional coordinate retention. |
| 8 | `RouteLayerDefaultsSijko` | Keeps core trail layers on and proposed trails off by default. | Default state verification. |
| 9 | `RouteLayerToggleSijko` | Allows proposed trails to toggle while keeping core layers locked. | Proposed on/off, attempts to disable locked layers. |
| 10 | `LocationPermissionRevokeDecisionSijko` | Decides whether debug self-revocation is available. | Unsupported Android version, supported/no permission, supported/permission granted. |

## Permission Flow Finding

The old debug revoke action was enabled on Android 13+ even when no foreground location permission was currently granted. Pressing it could still kill/relaunch the app even though there was nothing to revoke. The debug action now reports `NoForegroundPermissionGranted`, disables the revoke button, and tells the tester to use the current-location icon to trigger the normal permission request flow.

## Follow-On Map Sijkos

| Sijko | Job | Edge cases covered |
|-------|-----|--------------------|
| `MapPickerDefaultsSijko` | Provides the initial Bloomington-Normal camera point for the Google Maps picker. | Usable viewport bounds, initial point math. |
| `MapPointLabelSijko` | Formats map coordinates for endpoint labels and URL query values. | Display spacing, URL spacing, rounding. |
| `MapPointApplySijko` | Applies a map coordinate label or resolved address to the selected endpoint field while retaining the coordinate. | Start endpoint, destination endpoint, address fallback. |
| `MapPointSelectionResultMessageSijko` | Converts map picker results into user-facing error text. | Success, cancel, unavailable, custom error, blank error. |
| `RouteEndpointTextChangeSijko` | Applies manually typed endpoint text while clearing stale coordinate selections. | Start edits, destination edits, preserving the untouched endpoint coordinate. |

## Map Launch Finding

The map icon now opens an Android Google Maps SDK picker screen rather than writing a placeholder value. Android tracks the selected point from the real map camera target, moves that target when the user taps the map, keeps the confirmation controls inside safe system insets, previews the selected point's reverse-geocoded address on the map screen after a short debounce, and returns the resolved address to the shared UI with coordinates as fallback. The map requires a Google Maps API key supplied through local config (`MAPS_API_KEY` in `local.properties` or the environment); no key is committed to source control. iOS currently returns `Unavailable` until its native Google Maps picker is added.

## Routing Core Sijkos

| Sijko | Job | Edge cases covered |
|-------|-----|--------------------|
| `TrailFeatureFilterSijko` | Applies enabled route layers to normalized GIS features while keeping proposed trails opt-in. | Existing versus proposed features, explicit proposed enablement, disabled route-layer selections. |
| `TrailGraphBuilderSijko` | Converts filtered trail polylines into snapped graph nodes and edges using spatial buckets. | Multi-segment paths, nearby vertex snapping, nonzero edge distances. |
| `NearestTrailSnapSijko` | Projects an arbitrary point to the nearest approved trail graph edge. | Mid-segment projection and access-distance reporting. |
| `TrailEdgeWeightSijko` | Converts facility type, comfort level, and ordinary access distance into route-search cost. | Shared-lane penalty, ordinary-road access penalty. |
| `TrailRouteFinderSijko` | Finds a constrained route using only approved graph edges plus endpoint access connectors. | Successful graph route, proposed-only route blocked by default and allowed when proposed is enabled. |
| `TrailRouteSummarySijko` | Converts a constrained route into readable route mileage feedback. | Trail/access/total mileage reporting. |
| `TrailRoutePriorityQueue` | Supports route search with a min-heap instead of repeated full-node scans. | Lowest-cost entry ordering, empty queue behavior. |
