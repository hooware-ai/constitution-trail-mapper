/**
 * Job: Verify a rejoined ride is recorded as everything actually ridden, and nothing that was skipped.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.ExerciseRouteTraversalSijko
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailDistanceSijko
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.routing.TrailRouteSegmentType
import com.trailmapper.shared.routing.TrailRouteTraversalEdge
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class CarriedExerciseRideTest {
    @Test
    fun aSliceProratesTheEdgesItCuts() {
        val traversal = listOf(edge("a", 100.0, access = 40.0), edge("b", 200.0), edge("c", 100.0))

        val slice = ExerciseRouteTraversalSijko.slice(traversal, fromMeters = 50.0, toMeters = 250.0)

        assertEquals(listOf("a" to 50.0, "b" to 150.0), slice.map { it.key to it.distanceMeters })
        assertEquals(20.0, slice.first().ordinaryAccessDistanceMeters, 1e-9)
        assertEquals(listOf("c"), ExerciseRouteTraversalSijko.slice(traversal, fromMeters = 300.0).map { it.key })
    }

    @Test
    fun aCompletedRejoinedRideRecordsTheRiddenPartOfTheOriginalPlusTheReplacement() {
        val original = loop(edge("a", 1_000.0), edge("b", 1_000.0), edge("c", 1_000.0))
        // Left the loop 1.4 km in, then rode a 300 m connector and the loop's last 1.2 km.
        val carried = CarriedExerciseRide().plusRiddenPart(original, progressMeters = 1_400.0)
        val replacement = loop(edge("connector", 300.0), edge("b", 200.0), edge("c", 1_000.0))

        val session = assertNotNull(CompletedExerciseSessionFactorySijko.create(replacement, 1_000L, carried))

        assertEquals(1_400.0 + 1_500.0, session.completedDistanceMeters, 0.01)
        assertEquals(
            listOf("a" to 1_000.0, "b" to 400.0, "connector" to 300.0, "b" to 200.0, "c" to 1_000.0),
            session.traversalEdges.map { it.key to Math.round(it.distanceMeters * 100.0) / 100.0 },
        )
    }

    @Test
    fun anUnrejoinedRideIsRecordedAsBefore() {
        val route = loop(edge("a", 1_000.0))

        val session = assertNotNull(CompletedExerciseSessionFactorySijko.create(route, 1_000L))

        assertEquals(1_000.0, session.completedDistanceMeters)
        assertEquals(route.traversalEdges, session.traversalEdges)
    }

    @Test
    fun aRideHomeIsStillNotAWorkout() {
        val home = loop(edge("a", 1_000.0)).copy(kind = TrailRouteKind.Navigation)

        assertNull(CompletedExerciseSessionFactorySijko.create(home, 1_000L, CarriedExerciseRide(500.0)))
    }

    @Test
    fun theCarriedRideSurvivesSaving() {
        val carried = CarriedExerciseRide(1_400.0, listOf(edge("a", 1_000.0), edge("b", 400.0)))

        assertEquals(
            carried,
            TrailMapperPersistenceJsonSijko.decodeCarriedExerciseRide(
                TrailMapperPersistenceJsonSijko.encodeCarriedExerciseRide(carried),
            ),
        )
    }

    private fun edge(key: String, meters: Double, access: Double = 0.0) =
        TrailRouteTraversalEdge(key = key, distanceMeters = meters, ordinaryAccessDistanceMeters = access)

    /** A straight route north with one contiguous segment per traversal edge, as long as its distance. */
    private fun loop(vararg traversal: TrailRouteTraversalEdge): TrailRoute {
        var latitude = 40.0
        val segments = traversal.map { edge ->
            val from = MapPoint(latitude, -89.0)
            latitude += edge.distanceMeters / TrailDistanceSijko.metersBetween(MapPoint(40.0, -89.0), MapPoint(41.0, -89.0))
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(from, MapPoint(latitude, -89.0)), name = edge.key)
        }
        return TrailRoute(
            segments = segments,
            totalDistanceMeters = traversal.sumOf { it.distanceMeters },
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 0.0,
            kind = TrailRouteKind.ExerciseLoop,
            traversalEdges = traversal.toList(),
        )
    }
}
