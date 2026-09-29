/**
 * Job: Verify recent completed rides steer path search more strongly than old or unrelated rides.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExerciseRouteHistoryEdgeCostSijkoTest {
    @Test
    fun recentMatchingEdgesCostMoreThanOldOrUnrelatedEdges() {
        val edge = edge(1, "used")
        // A different road: same length, about 850 m east.
        val unrelated = edge(2, "new", longitude = -88.99)
        val traversal = ExerciseRouteTraversalSijko.traversalFor(listOf(edge))
        val now = 1_700_000_000_000L
        val recent = ExerciseRouteHistoryEdgeCostSijko.costsByEdgeId(
            listOf(edge, unrelated),
            listOf(session("recent", traversal, now)),
            now,
        )
        val old = ExerciseRouteHistoryEdgeCostSijko.costsByEdgeId(
            listOf(edge, unrelated),
            listOf(session("old", traversal, now - 84L * 24L * 60L * 60L * 1_000L)),
            now,
        )

        assertTrue(recent.getValue(edge.id) > old.getValue(edge.id) * 10.0)
        assertTrue(unrelated.id !in recent)
    }

    @Test
    fun renumberedSourceOnTheSameRoadKeepsItsHistoryCost() {
        val recorded = edge(1, "8:100")
        val renumbered = edge(1, "8:999")
        val now = 1_700_000_000_000L
        val sessions = listOf(session("ride", ExerciseRouteTraversalSijko.traversalFor(listOf(recorded)), now))

        assertEquals(
            ExerciseRouteHistoryEdgeCostSijko.costsByEdgeId(listOf(recorded), sessions, now).getValue(1),
            ExerciseRouteHistoryEdgeCostSijko.costsByEdgeId(listOf(renumbered), sessions, now).getValue(1),
        )
    }

    private fun edge(id: Int, source: String, longitude: Double = -89.0): TrailGraphEdge {
        return TrailGraphEdge(
            id = id,
            fromNodeId = id * 2,
            toNodeId = id * 2 + 1,
            distanceMeters = 500.0,
            sourceFeatureId = source,
            routeSegments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(MapPoint(40.0, longitude), MapPoint(40.004, longitude)),
                ),
            ),
        )
    }

    private fun session(
        id: String,
        traversalEdges: List<TrailRouteTraversalEdge>,
        completedAtEpochMillis: Long,
    ): CompletedExerciseSession {
        return CompletedExerciseSession(id, id, completedAtEpochMillis, 500.0, traversalEdges)
    }
}
