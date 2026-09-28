/**
 * Job: Verify recency scoring includes traveled access roads while discounting endpoint stems.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import kotlin.test.Test
import kotlin.test.assertTrue

class ExerciseRouteOverlapSijkoTest {
    @Test
    fun recentHistoryCountsMoreThanOldHistoryAcrossTrailAndAccess() {
        val route = listOf(
            TrailRouteTraversalEdge("access", 100.0, ordinaryAccessDistanceMeters = 100.0),
            TrailRouteTraversalEdge("trail", 400.0),
            TrailRouteTraversalEdge("trail", 400.0),
        )
        val now = 1_700_000_000_000L
        val recent = ExerciseRouteOverlapSijko.historyOverlapMeters(
            route,
            listOf(session("recent", route, now)),
            now,
        )
        val old = ExerciseRouteOverlapSijko.historyOverlapMeters(
            route,
            listOf(session("old", route, now - 84L * 24L * 60L * 60L * 1_000L)),
            now,
        )

        assertTrue(recent > old * 10.0)
        assertTrue(ExerciseRouteOverlapSijko.selfOverlapMeters(route) > 0.0)
        val accessOnly = listOf(TrailRouteTraversalEdge("access", 500.0, ordinaryAccessDistanceMeters = 500.0))
        assertTrue(
            ExerciseRouteOverlapSijko.historyOverlapMeters(
                accessOnly,
                listOf(session("access", accessOnly, now)),
                now,
            ) > 0.0,
        )
    }

    private fun session(
        id: String,
        traversalEdges: List<TrailRouteTraversalEdge>,
        completedAtEpochMillis: Long,
    ): CompletedExerciseSession {
        return CompletedExerciseSession(id, id, completedAtEpochMillis, 0.0, traversalEdges)
    }
}
