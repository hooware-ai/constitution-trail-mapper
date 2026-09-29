/**
 * Job: Verify exercise traversal and route keys remain stable when route direction changes.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExerciseRouteKeySijkoTest {
    @Test
    fun normalizesEdgeGeometryAndRouteDirection() {
        val first = MapPoint(40.0, -89.0)
        val second = MapPoint(40.001, -89.0)
        val forward = edge(first, second)
        val reverse = edge(second, first).copy(fromNodeId = 9, toNodeId = 3)

        assertEquals(ExerciseRouteTraversalSijko.keyFor(forward), ExerciseRouteTraversalSijko.keyFor(reverse))
        val forwardTraversal = ExerciseRouteTraversalSijko.traversalFor(listOf(forward, reverse))
        val reverseTraversal = ExerciseRouteTraversalSijko.traversalFor(listOf(reverse, forward))
        assertEquals(ExerciseRouteKeySijko.keyFor(forwardTraversal), ExerciseRouteKeySijko.keyFor(reverseTraversal))
        assertTrue(ExerciseRouteTargetSijko.isValid(804.672))
        assertTrue(!ExerciseRouteTargetSijko.isValid(804.0))
        assertEquals("15 min", ExerciseRouteDurationSijko.formatFor(3_218.688))
    }

    private fun edge(first: MapPoint, second: MapPoint): TrailGraphEdge {
        return TrailGraphEdge(
            id = 1,
            fromNodeId = 1,
            toNodeId = 2,
            distanceMeters = 100.0,
            sourceFeatureId = "stable-feature",
            routeSegments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(first, second),
                ),
            ),
        )
    }
}
