/**
 * Job: Verify via-loop retrace estimates read the shared stem and final spur from the search trees.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.PI
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals

class ExerciseRouteViaOverlapSijkoTest {
    // Root R, anchor B up the stem through A; a side branch A-C; a western route R-W-H with a spur H-G
    // and a crossing B-H.
    private val r = offset(0.0, 0.0)
    private val a = offset(0.0, 100.0)
    private val b = offset(0.0, 200.0)
    private val c = offset(100.0, 100.0)
    private val w = offset(-100.0, 0.0)
    private val h = offset(-100.0, 150.0)
    private val g = offset(-100.0, 200.0)
    private val graph = TrailGraphBuilderSijko.buildGraph(
        listOf(
            feature("stem", r, a),
            feature("anchor-leg", a, b),
            feature("side", a, c),
            feature("west", r, w),
            feature("west-up", w, h),
            feature("spur", h, g),
            feature("cross", b, h),
        ),
    )
    private val adjacency = ExerciseRouteSearchSijko.adjacencyFor(graph)
    private val overlap = ExerciseRouteViaOverlapSijko(
        rootSearch = search(from = r),
        fromAnchorSearch = search(from = b),
        anchorNodeId = node(b),
    )

    @Test
    fun countsTheStemSharedWithTheAnchorAndTheSpurBothBranchesArriveBy() {
        // Back from C the return rides R-A again, and A-C is ridden out and back.
        assertEquals(200.0, overlap.retracedMeters(node(c)), 0.5)
    }

    @Test
    fun countsOnlyTheSpurWhenTheBranchesPartAtTheRoot() {
        // Root reaches G by R-W-H-G and the anchor by B-H-G: only H-G is ridden twice.
        assertEquals(50.0, overlap.retracedMeters(node(g)), 0.5)
    }

    @Test
    fun aViaReachedFromOtherSidesRetracesNothing() {
        // Root reaches W directly and the anchor by B-H-W.
        assertEquals(0.0, overlap.retracedMeters(node(w)), 0.5)
    }

    private fun search(from: MapPoint) = ExerciseRouteSearchSijko.searchTree(
        adjacency = adjacency,
        startNodeId = node(from),
        edgeCost = { edge -> edge.distanceMeters },
        cancellationCheckpoint = {},
    )

    private fun node(point: MapPoint): Int = graph.nodes.single { it.point == point }.id

    private fun feature(id: String, vararg points: MapPoint) = TrailNetworkFeature(
        id = id,
        name = null,
        status = TrailFeatureStatus.Existing,
        routeRoles = setOf(TrailNetworkRole.TrailBranches),
        facilityType = TrailFacilityType.UrbanTrail,
        comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        paths = listOf(points.toList()),
    )

    /** A point [eastMeters] east and [northMeters] north of (40, -89). */
    private fun offset(eastMeters: Double, northMeters: Double): MapPoint {
        val metersPerDegree = 6_371_008.8 * PI / 180.0
        return MapPoint(
            latitude = 40.0 + northMeters / metersPerDegree,
            longitude = -89.0 + eastMeters / (metersPerDegree * cos(40.0 * PI / 180.0)),
        )
    }
}
