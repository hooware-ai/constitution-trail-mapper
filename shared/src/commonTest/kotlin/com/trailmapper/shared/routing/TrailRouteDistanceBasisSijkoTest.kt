/**
 * Job: Verify navigation distance converts to traversal distance across bridged gaps.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CarriedExerciseRide
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TrailRouteDistanceBasisSijkoTest {
    @Test
    fun navigationPastABridgedGapMapsBackOntoTheTraversal() {
        val route = gappedRoute()
        val firstLeg = TrailDistanceSijko.metersBetween(a, b)
        val gap = TrailDistanceSijko.metersBetween(b, c)
        assertTrue(gap in 15.0..25.0)

        // 50 m into the second segment, as navigation measures it (the bridged gap included).
        val rider = MapPoint(c.latitude + 50.0 / 111_320.0, c.longitude)
        val snapshot = assertNotNull(
            TrailRouteNavigationSnapshotSijko.snapshotFor(route, TrailRouteTurnInstructionSijko.instructionsFor(route), rider),
        )
        assertEquals(firstLeg + gap + 50.0, snapshot.distanceAlongRouteMeters, 0.5)

        assertEquals(firstLeg + 50.0, TrailRouteDistanceBasisSijko.traversalMetersAt(route, snapshot.distanceAlongRouteMeters), 0.5)
        // Inside the bridge itself, nothing of the second segment has been covered yet.
        assertEquals(firstLeg, TrailRouteDistanceBasisSijko.traversalMetersAt(route, firstLeg + gap / 2.0), 1e-6)
    }

    @Test
    fun aRideLeftAfterAGappedJoinCreditsTheRightEdges() {
        val route = gappedRoute()
        val firstLeg = TrailDistanceSijko.metersBetween(a, b)
        val gap = TrailDistanceSijko.metersBetween(b, c)

        val carried = CarriedExerciseRide().plusRiddenPart(route, progressMeters = firstLeg + gap + 50.0)

        assertEquals(firstLeg + 50.0, carried.distanceMeters, 0.5)
        assertEquals(listOf("first", "second"), carried.traversalEdges.map { it.key })
        assertEquals(50.0, carried.traversalEdges.last().distanceMeters, 0.5)
    }

    @Test
    fun segmentsFromCutsTheSegmentTheDistanceFallsIn() {
        val route = gappedRoute()
        val firstLeg = TrailDistanceSijko.metersBetween(a, b)

        val rest = TrailRouteDistanceBasisSijko.segmentsFrom(route, firstLeg + 50.0)

        assertEquals(1, rest.size)
        assertEquals(d, rest.single().points.last())
        assertEquals(TrailDistanceSijko.metersBetween(c, d) - 50.0, TrailDistanceSijko.pathLengthMeters(rest.single().points), 0.5)
    }

    @Test
    fun aGapIsBridgedOnlyWhereTheDrawnRouteJoinsThatBoundary() {
        // Trail a-b, then access c-d (a different style, so the b-c gap is not bridged), then trail d-b-c-a,
        // which passes from b to c again later in the route.
        val route = TrailRoute(
            segments = listOf(
                TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(a, b), name = "Main trail"),
                TrailRouteSegment(TrailRouteSegmentType.Access, listOf(c, d), name = "Access road"),
                TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(d, b, c, a), name = "Main trail"),
            ),
            totalDistanceMeters = 0.0,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 0.0,
        )
        val firstLeg = TrailDistanceSijko.metersBetween(a, b)

        assertEquals(emptyMap(), TrailRouteDrawableSegmentMergeSijko.bridgedGaps(route.segments))
        assertEquals(firstLeg + 50.0, TrailRouteDistanceBasisSijko.geometryMetersAt(route, firstLeg + 50.0), 1e-6)
    }

    @Test
    fun aConnectorWhoseGeometryIsLongerThanItsDistanceIsProratedWithinIt() {
        // A snap connector: 40 m of geometry recorded as a 28 m graph distance, then a 100 m edge.
        val traversal = listOf(
            TrailRouteTraversalEdge("connector", distanceMeters = 28.0, geometryMeters = 40.0),
            TrailRouteTraversalEdge("trail", distanceMeters = 100.0, geometryMeters = 100.0),
        )

        assertEquals(14.0, TrailRouteDistanceBasisSijko.traversalMetersAtGeometry(traversal, 20.0), 1e-9)
        assertEquals(28.0 + 50.0, TrailRouteDistanceBasisSijko.traversalMetersAtGeometry(traversal, 90.0), 1e-9)
        // Without recorded geometry (older records) the distance is the measure.
        assertEquals(20.0, TrailRouteDistanceBasisSijko.traversalMetersAtGeometry(traversal.map { it.copy(geometryMeters = null) }, 20.0), 1e-9)
    }

    /** Two same-styled trail segments 20 m apart, which the drawn route bridges and navigation measures. */
    private fun gappedRoute(): TrailRoute {
        val segments = listOf(
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(a, b), name = "Main trail"),
            TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(c, d), name = "Main trail"),
        )
        val traversal = listOf(
            TrailRouteTraversalEdge("first", TrailDistanceSijko.metersBetween(a, b)),
            TrailRouteTraversalEdge("second", TrailDistanceSijko.metersBetween(c, d)),
        )
        return TrailRoute(
            segments = segments,
            totalDistanceMeters = traversal.sumOf { it.distanceMeters },
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 0.0,
            kind = TrailRouteKind.ExerciseLoop,
            traversalEdges = traversal,
        )
    }

    private val a = MapPoint(40.0, -89.0)
    private val b = MapPoint(40.0045, -89.0)
    private val c = MapPoint(40.0045 + 20.0 / 111_320.0, -89.0)
    private val d = MapPoint(40.009, -89.0)
}
