/**
 * Job: Verify deterministic exercise-loop construction over synthetic trail networks.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ExerciseRouteCalculationSijkoTest {
    @Test
    fun findsExactCycleWithExerciseMetadata() {
        val start = point(0.0, 0.0)
        val result = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(feature("square", square(start))),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )

        assertEquals(ExerciseRouteStatus.Exact, result.status)
        assertEquals(TrailRouteKind.ExerciseLoop, result.route.kind)
        assertEquals(halfMile, result.route.requestedDistanceMeters)
        assertTrue(result.route.traversalEdges.isNotEmpty())
        assertTrue(result.route.segments.first().points.first() == start)
        assertTrue(result.route.segments.last().points.last() == start)
        assertTrue(result.summary.contains("8 mph"))
        assertTrue(result.durationSummary.isNotBlank())
    }

    @Test
    fun prefersSaferCycleWhenDistanceIsComparable() {
        val start = point(0.0, 0.0)
        val safe = square(start)
        val shared = listOf(
            start,
            point(0.0, 0.0020),
            point(-0.0018, 0.0020),
            point(-0.0018, 0.0),
            start,
        )
        val result = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(
                    feature("safe", safe),
                    feature("shared", shared, roles = setOf(TrailNetworkRole.SharedRoadways)),
                ),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )

        assertTrue(result.route.edges.none { it.sourceFeatureId == "shared" })
    }

    @Test
    fun discountsUnavoidableSharedStemFromSelfOverlap() {
        val start = point(0.0, 0.0)
        val junction = point(0.0018, 0.0)
        val north = point(0.0036, 0.0)
        val east = point(0.0018, 0.0018)
        val features = listOf(
            feature("stem", listOf(start, junction)),
            feature("cycle", listOf(junction, north, point(0.0036, 0.0018), east, junction)),
        )
        val result = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = features,
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = 1_500.0,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )

        assertTrue(result.selfOverlapMeters < 200.0)
    }

    @Test
    fun returnsClosestOutAndBackWhenNoCycleExists() {
        val start = point(0.0, 0.0)
        val result = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(feature("branch", listOf(start, point(0.0018, 0.0), point(0.0036, 0.0)))),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )

        assertEquals(ExerciseRouteStatus.Closest, result.status)
        assertTrue(result.selfOverlapMeters > 0.0)
    }

    @Test
    fun aCircuitWithinTargetToleranceBeatsAnOutAndBackCandidate() {
        val start = point(0.0, 0.0)
        val result = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(
                    feature("circuit", square(start)),
                    feature("branch", listOf(start, point(-0.0036, 0.0))),
                ),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )

        assertTrue(
            ExerciseRouteLoopQualitySijko.isCircuit(
                totalDistanceMeters = result.route.totalDistanceMeters,
                selfOverlapMeters = result.selfOverlapMeters,
            ),
        )
        assertTrue(result.route.edges.any { edge -> edge.sourceFeatureId == "circuit" })
    }

    @Test
    fun aFarTooShortCircuitDoesNotBeatANearTargetOutAndBack() {
        val start = point(0.0, 0.0)
        // A circuit of about 220 m against a 400 m branch whose out-and-back is near the half-mile target.
        val tinyCircuit = listOf(
            start,
            point(0.0005, 0.0),
            point(0.0005, 0.0005),
            point(0.0, 0.0005),
            start,
        )
        val result = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(
                    feature("tiny-circuit", tinyCircuit),
                    feature("branch", listOf(start, point(-0.0036, 0.0))),
                ),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )

        assertTrue(result.route.edges.any { edge -> edge.sourceFeatureId == "branch" })
        assertTrue(
            result.distanceErrorMeters <= ExerciseRouteTargetSijko.toleranceMeters(halfMile),
            "Expected a near-target route, got ${result.route.totalDistanceMeters} m",
        )
        assertEquals(ExerciseRouteStatus.Closest, result.status)
    }

    @Test
    fun aSafeOutAndBackBeatsACircuitThroughAReviewedHazard() {
        val hazard = TrailRoutingHazardCatalogSijko.hazards.first().center
        // The square's far side runs straight through the hazard center.
        val start = point(hazard.latitude - 0.0018, hazard.longitude - 0.0009)
        val result = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(
                    feature("hazard-circuit", square(start)),
                    feature("branch", listOf(start, point(start.latitude - 0.0036, start.longitude))),
                ),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )

        assertEquals(0.0, result.route.edges.sumOf(TrailRoutingHazardPenaltySijko::additionalCost))
        assertTrue(result.route.edges.any { edge -> edge.sourceFeatureId == "branch" })
        assertEquals(ExerciseRouteStatus.Closest, result.status)
    }

    @Test
    fun scoresRecentCompletedHistoryAndKeepsProposedTrailsOptIn() {
        val start = point(0.0, 0.0)
        val feature = feature("future", square(start), status = TrailFeatureStatus.Proposed)
        assertNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(feature),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )

        val baseline = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(feature),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = true),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )
        val repeated = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = listOf(feature),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = true),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = listOf(
                    CompletedExerciseSession(
                        id = "recent",
                        routeKey = baseline.routeKey,
                        completedAtEpochMillis = now,
                        completedDistanceMeters = baseline.route.totalDistanceMeters,
                        traversalEdges = baseline.route.traversalEdges,
                    ),
                ),
                nowEpochMillis = now,
            ),
        )

        assertTrue(repeated.historyOverlapMeters > 0.0)
    }

    @Test
    fun recentCompletedRouteMovesTheNextResultToAnAvailableAlternative() {
        val start = point(0.0, 0.0)
        val features = listOf(
            feature("north-east", square(start)),
            feature(
                "south-west",
                listOf(
                    start,
                    point(start.latitude - 0.0018, start.longitude),
                    point(start.latitude - 0.0018, start.longitude - 0.0018),
                    point(start.latitude, start.longitude - 0.0018),
                    start,
                ),
            ),
        )
        val baseline = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = features,
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )
        val next = assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = features,
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = listOf(
                    CompletedExerciseSession(
                        id = "recent",
                        routeKey = baseline.routeKey,
                        completedAtEpochMillis = now,
                        completedDistanceMeters = baseline.route.totalDistanceMeters,
                        traversalEdges = baseline.route.traversalEdges,
                    ),
                ),
                nowEpochMillis = now,
            ),
        )

        assertTrue(next.routeKey != baseline.routeKey)
        assertTrue(next.historyOverlapMeters < baseline.route.totalDistanceMeters * 0.10)
    }

    @Test
    fun validatesTargetsPropagatesCancellationAndRejectsDisconnectedStart() {
        val start = point(0.0, 0.0)
        val features = listOf(feature("square", square(start)))
        assertNotNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = features,
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                accessGraph = TrailGraph(emptyList(), emptyList()),
                nowEpochMillis = now,
            ),
        )
        assertNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = features,
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = 100.0,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )
        assertFailsWith<CancellationException> {
            ExerciseRouteCalculationSijko.findRoute(
                features = features,
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
                cancellationCheckpoint = { throw CancellationException("cancel exercise search") },
            )
        }
        assertNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = features,
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = point(1.0, 1.0),
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )
    }

    @Test
    fun returnsNullForEmptyNetwork() {
        assertNull(
            ExerciseRouteCalculationSijko.findRoute(
                features = emptyList(),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = point(0.0, 0.0),
                targetDistanceMeters = halfMile,
                completedSessions = emptyList(),
                nowEpochMillis = now,
            ),
        )
    }

    private fun square(start: MapPoint): List<MapPoint> {
        return listOf(
            start,
            point(start.latitude + 0.0018, start.longitude),
            point(start.latitude + 0.0018, start.longitude + 0.0018),
            point(start.latitude, start.longitude + 0.0018),
            start,
        )
    }

    private fun feature(
        id: String,
        path: List<MapPoint>,
        roles: Set<TrailNetworkRole> = setOf(TrailNetworkRole.TrailBranches),
        status: TrailFeatureStatus = TrailFeatureStatus.Existing,
    ): TrailNetworkFeature {
        return TrailNetworkFeature(
            id = id,
            status = status,
            routeRoles = roles,
            facilityType = TrailFacilityType.UrbanTrail,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
            paths = listOf(path),
        )
    }

    private fun point(latitude: Double, longitude: Double): MapPoint = MapPoint(latitude, longitude)

    private companion object {
        const val halfMile = 804.672
        const val now = 1_700_000_000_000L
    }
}
