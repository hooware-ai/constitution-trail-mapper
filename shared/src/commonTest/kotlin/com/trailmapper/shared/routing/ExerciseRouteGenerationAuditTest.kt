/**
 * Job: Reproduce exercise-generation false negatives found in the September 7 audit.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ExerciseRouteGenerationAuditTest {
    @Test
    fun findsExactLoopDespiteANearbyDisconnectedSpur() {
        val start = MapPoint(0.0, 0.0)
        val loop = square(MapPoint(0.0, 0.001))
        val baseline = assertNotNull(find(listOf(loop), start, 1_000.0))
        assertEquals(ExerciseRouteStatus.Exact, baseline.status)

        val spur = feature("spur", listOf(start, MapPoint(-0.0003, 0.0)))
        val allFeatures = listOf(spur, loop)
        val graph = TrailGraphBuilderSijko.buildGraph(allFeatures)
        val candidates = NearestTrailSnapSijko.nearestSnaps(
            graph = graph,
            point = start,
            limit = 2,
            maxAccessDistanceMeters = 800.0,
            includeNodeSnaps = true,
        )
        assertEquals(2, candidates.size)
        assertTrue(candidates.all { it.edge.sourceFeatureId == "spur" })
        assertEquals(candidates[0].projectedPoint, candidates[1].projectedPoint)

        val obscured = assertNotNull(find(allFeatures, start, 1_000.0))
        assertEquals(ExerciseRouteStatus.Exact, obscured.status)
        assertTrue(obscured.route.edges.any { it.sourceFeatureId == "loop" })
    }

    @Test
    fun anExactPrimaryLoopDoesNotTriggerExtraCandidateSearches() {
        val start = MapPoint(0.0, 0.0)
        val primary = square(start)
        var baselineCandidates = 0
        val baseline = assertNotNull(
            find(listOf(primary), start, 804.672) { _, _, _ -> baselineCandidates++ },
        )
        assertEquals(ExerciseRouteStatus.Exact, baseline.status)
        val alternate = square(MapPoint(0.0, -0.003)).copy(id = "alternate")
        var expandedCandidates = 0
        val expanded = assertNotNull(
            find(listOf(primary, alternate), start, 804.672) { _, _, _ -> expandedCandidates++ },
        )
        assertEquals(baseline.routeKey, expanded.routeKey)
        assertEquals(baseline.route.totalDistanceMeters, expanded.route.totalDistanceMeters)
        assertEquals(baselineCandidates, expandedCandidates)
    }

    @Test
    fun doesNotReplaceExistingTrailTravelWithEstimatedAccessWithinSameComponent() {
        val start = MapPoint(0.0, 0.0)
        val branch = feature(
            "branch",
            listOf(start, MapPoint(0.0018, 0.0), MapPoint(0.0036, 0.0)),
        )
        val result = assertNotNull(find(listOf(branch), start, 804.672))
        assertEquals(
            0.0,
            result.route.ordinaryAccessDistanceMeters,
            "Starting on the connected trail must retain trail travel: " +
                "status=${result.status}, total=${result.route.totalDistanceMeters}, " +
                "overlap=${result.selfOverlapMeters}, edges=${result.route.edges}",
        )
        assertEquals(ExerciseRouteStatus.Closest, result.status)
    }

    @Test
    fun boundedSearchRetainsAShorterCostlierPathNeededToReachAnExistingDestination() {
        // 0 -> 1 costs 600 and uses 600 m. 0 -> 2 -> 1 costs 1,000 but uses 300 m.
        // The only last leg, 1 -> 3, uses 500 m. Thus only the second route fits 1,000 m.
        val edges = listOf(
            TrailGraphEdge(id = 0, fromNodeId = 0, toNodeId = 1, distanceMeters = 600.0),
            TrailGraphEdge(id = 1, fromNodeId = 0, toNodeId = 2, distanceMeters = 150.0),
            TrailGraphEdge(id = 2, fromNodeId = 2, toNodeId = 1, distanceMeters = 150.0),
            TrailGraphEdge(id = 3, fromNodeId = 1, toNodeId = 3, distanceMeters = 500.0),
        )
        val graph = TrailGraph(
            nodes = (0..3).map { TrailGraphNode(it, MapPoint(it * 0.001, 0.0)) },
            edges = edges,
        )
        val tree = ExerciseRouteSearchSijko.searchTree(
            adjacency = ExerciseRouteSearchSijko.adjacencyFor(graph),
            startNodeId = 0,
            edgeCost = { if (it.id == 1 || it.id == 2) 500.0 else it.distanceMeters },
            maximumPhysicalDistanceMeters = 1_000.0,
            cancellationCheckpoint = {},
        )
        // Node 1 still reports its cheapest label; the shorter one survives to reach node 3.
        assertEquals(600.0, tree.physicalDistancesMeters[1])
        val path = assertNotNull(ExerciseRouteSearchSijko.pathTo(tree, 3))
        assertEquals(listOf(1, 2, 3), path.edges.map { it.id })
        assertEquals(800.0, path.totalDistanceMeters)
        assertEquals(1_500.0, path.totalCost)
    }

    private fun find(
        features: List<TrailNetworkFeature>,
        start: MapPoint,
        target: Double,
        candidateObserver: (Double, Double, Boolean) -> Unit = { _, _, _ -> },
    ): ExerciseRouteResult? =
        ExerciseRouteCalculationSijko.findRoute(
            features = features,
            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
            startPoint = start,
            targetDistanceMeters = target,
            completedSessions = emptyList(),
            nowEpochMillis = 1_700_000_000_000L,
            candidateObserver = candidateObserver,
        )

    private fun square(start: MapPoint): TrailNetworkFeature = feature(
        "loop",
        listOf(
            start,
            MapPoint(start.latitude + 0.0018, start.longitude),
            MapPoint(start.latitude + 0.0018, start.longitude + 0.0018),
            MapPoint(start.latitude, start.longitude + 0.0018),
            start,
        ),
    )

    private fun feature(id: String, points: List<MapPoint>): TrailNetworkFeature = TrailNetworkFeature(
        id = id,
        status = TrailFeatureStatus.Existing,
        routeRoles = setOf(TrailNetworkRole.TrailBranches),
        facilityType = TrailFacilityType.UrbanTrail,
        comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        paths = listOf(points),
    )

}
