/**
 * Job: Reproduce connected-route availability failures without widening access distance policies.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TrailRouteAvailabilityAuditTest {
    @Test
    fun keepsAnOnTrailRouteAvailableWhenTheAccessGraphIsEmpty() {
        val start = point(0.0, 0.0)
        val destination = point(1_000.0, 0.0)
        val trailGraph = trailGraph(listOf("main" to listOf(start, destination)))

        assertNotNull(TrailRouteFinderSijko.findRoute(trailGraph, start, destination))
        assertNotNull(
            TrailRouteWithAccessFinderSijko.findRoute(
                trailGraph = trailGraph,
                accessGraph = TrailGraph(emptyList(), emptyList()),
                start = start,
                destination = destination,
            ),
            "An empty road dataset must not hide a route whose endpoints are already on one trail.",
        )
    }

    @Test
    fun doesNotLetDuplicateJunctionAccessesHideTheOnlyConnectedTrailEntry() {
        val start = point(0.0, 0.0)
        val entry = point(200.0, 0.0)
        val destination = point(2_000.0, 0.0)
        val trailGraph = trailGraph(
            listOf(
                "north-spur" to listOf(start, point(0.0, 100.0)),
                "south-spur" to listOf(start, point(0.0, -100.0)),
                "northwest-spur" to listOf(start, point(-100.0, 100.0)),
                "southwest-spur" to listOf(start, point(-100.0, -100.0)),
                "main" to listOf(entry, destination),
            ),
        )
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            listOf(AccessNetworkFeature(id = "entry-road", paths = listOf(listOf(start, entry)))),
        )
        val expandedStarts = TrailRouteEndpointAccessSelectorSijko.candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = start,
            resultLimit = 16,
        )
        val destinationCandidates = TrailRouteEndpointAccessSelectorSijko.candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = destination,
        )
        assertTrue(expandedStarts.any { it.snap.edge.sourceFeatureId == "main" })
        assertNotNull(
            TrailRouteFinderSijko.findRoute(
                graph = trailGraph,
                startAccesses = expandedStarts,
                destinationAccesses = destinationCandidates,
            ),
            "The fixture has a wholly mapped 200m access road to a connected existing trail.",
        )

        assertNotNull(
            TrailRouteWithAccessFinderSijko.findRoute(trailGraph, accessGraph, start, destination),
            "Duplicate direct/routed snaps at the nearby junction must not exhaust all eight slots.",
        )
    }

    @Test
    fun retriesExistingExtendedAccessPolicyWhenConservativeCandidatesCannotConnect() {
        val start = point(0.0, 0.0)
        val entry = point(2_000.0, 0.0)
        val destination = point(4_000.0, 0.0)
        val trailGraph = trailGraph(
            listOf(
                "isolated-nearby-spur" to listOf(start, point(0.0, 200.0)),
                "main" to listOf(entry, destination),
            ),
        )
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            listOf(AccessNetworkFeature(id = "entry-road", paths = listOf(listOf(start, entry)))),
        )
        val extendedStarts = TrailRouteEndpointAccessSelectorSijko.candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = start,
            maxTrailCandidateStraightMeters = 6_500.0,
            maxAccessRouteMeters = 12_000.0,
            maxEndpointSnapMeters = 1_000.0,
            roughCandidateLimit = 64,
        )
        val destinationCandidates = TrailRouteEndpointAccessSelectorSijko.candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = destination,
        )
        assertNotNull(
            TrailRouteFinderSijko.findRoute(
                graph = trailGraph,
                startAccesses = extendedStarts,
                destinationAccesses = destinationCandidates,
            ),
            "The fixture route is inside the extended fallback bounds already used in production.",
        )

        assertNotNull(
            TrailRouteWithAccessFinderSijko.findRoute(trailGraph, accessGraph, start, destination),
            "A nearby isolated trail must not suppress the existing extended road-access fallback.",
        )
    }

    @Test
    fun filtersIneligiblePathSnapsBeforeTheirSearchLimitCanHideAnEligibleRoad() {
        val start = point(0.0, 0.0)
        val roadStart = point(0.0, 70.0)
        val destination = point(1_000.0, 70.0)
        // These are independent source edges. Explicit graph construction isolates candidate
        // selection from vertex-merging rules and models a dense path dataset near an endpoint.
        val nodes = mutableListOf<TrailGraphNode>()
        val edges = mutableListOf<TrailGraphEdge>()
        fun addEdge(id: String, roadClass: String, from: MapPoint, to: MapPoint) {
            val fromId = nodes.size
            nodes += TrailGraphNode(fromId, from)
            val toId = nodes.size
            nodes += TrailGraphNode(toId, to)
            val distance = TrailDistanceSijko.metersBetween(from, to)
            edges += TrailGraphEdge(
                id = edges.size,
                fromNodeId = fromId,
                toNodeId = toId,
                distanceMeters = distance,
                ordinaryAccessDistanceMeters = distance,
                accessRoadClass = roadClass,
                sourceFeatureId = id,
                routeSegments = listOf(
                    TrailRouteSegment(
                        type = TrailRouteSegmentType.Access,
                        points = listOf(from, to),
                        isRouted = true,
                    ),
                ),
            )
        }
        repeat(32) { index ->
            addEdge(
                id = "ineligible-path-$index",
                roadClass = "S1820",
                from = point(-10.0, 20.0 + index),
                to = point(10.0, 20.0 + index),
            )
        }
        addEdge("eligible-road", "S1400", roadStart, destination)
        val accessGraph = TrailGraph(nodes, edges)

        assertNotNull(
            TrailRouteAccessPathFinderSijko.findRoute(
                accessGraph = accessGraph,
                start = start,
                destination = destination,
                snapCandidateLimit = 5,
            ),
            "The mapped road is inside the unchanged 250m endpoint limit.",
        )
        assertNotNull(
            TrailRouteAccessPathFinderSijko.findRoute(accessGraph, start, destination),
            "Thirty-two disallowed path snaps must not hide the eligible road behind them.",
        )
    }

    private fun trailGraph(paths: List<Pair<String, List<MapPoint>>>): TrailGraph {
        return TrailGraphBuilderSijko.buildGraph(
            features = paths.map { (id, path) ->
                TrailNetworkFeature(
                    id = id,
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(path),
                )
            },
        )
    }

    private fun point(eastMeters: Double, northMeters: Double): MapPoint {
        return MapPoint(
            latitude = 40.0 + northMeters / 111_195.0,
            longitude = -89.0 + eastMeters / 85_180.0,
        )
    }
}
