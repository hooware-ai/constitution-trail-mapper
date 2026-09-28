/**
 * Job: Verify completion records are created only for history-capable exercise loops.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.ExerciseRouteKeySijko
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.routing.TrailRouteTraversalEdge
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CompletedExerciseSessionFactorySijkoTest {
    @Test
    fun createsAStableCompletedExerciseSession() {
        val traversalEdges = listOf(
            TrailRouteTraversalEdge(key = "edge-b", distanceMeters = 200.0),
            TrailRouteTraversalEdge(key = "edge-a", distanceMeters = 100.0),
        )
        val route = route(kind = TrailRouteKind.ExerciseLoop, traversalEdges = traversalEdges)

        val session = CompletedExerciseSessionFactorySijko.create(
            route = route,
            completedAtEpochMillis = 42L,
        )

        val expectedRouteKey = ExerciseRouteKeySijko.keyFor(traversalEdges)
        assertEquals(expectedRouteKey, session?.routeKey)
        assertEquals("42:$expectedRouteKey", session?.id)
        assertEquals(route.totalDistanceMeters, session?.completedDistanceMeters)
        assertEquals(traversalEdges, session?.traversalEdges)
    }

    @Test
    fun rejectsNavigationRoutesAndRoutesWithoutTraversalMetadata() {
        assertNull(
            CompletedExerciseSessionFactorySijko.create(
                route = route(kind = TrailRouteKind.Navigation),
                completedAtEpochMillis = 42L,
            ),
        )
        assertNull(
            CompletedExerciseSessionFactorySijko.create(
                route = route(kind = TrailRouteKind.ExerciseLoop),
                completedAtEpochMillis = 42L,
            ),
        )
    }

    private fun route(
        kind: TrailRouteKind,
        traversalEdges: List<TrailRouteTraversalEdge> = emptyList(),
    ): TrailRoute {
        return TrailRoute(
            totalDistanceMeters = 1_609.344,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1_609.344,
            kind = kind,
            traversalEdges = traversalEdges,
        )
    }
}
