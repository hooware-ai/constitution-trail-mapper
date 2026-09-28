/**
 * Job: Verify ordinary-road circuit tuning stays inactive without a valid oversized route and access graph.
 *
 */
package com.trailmapper.shared.routing

import kotlin.test.Test
import kotlin.test.assertEquals

class ExerciseRouteShortcutSijkoTest {
    @Test
    fun rejectsEmptyAndAlreadyShortRoutes() {
        val graph = TrailGraph(nodes = emptyList(), edges = emptyList())

        assertEquals(
            emptyList(),
            ExerciseRouteShortcutSijko.candidates(
                routeEdges = emptyList(),
                accessGraph = graph,
                targetDistanceMeters = 5_000.0,
            ),
        )
        assertEquals(
            emptyList(),
            ExerciseRouteShortcutSijko.candidates(
                routeEdges = listOf(
                    TrailGraphEdge(
                        id = 1,
                        fromNodeId = 1,
                        toNodeId = 2,
                        distanceMeters = 1_000.0,
                    ),
                ),
                accessGraph = graph,
                targetDistanceMeters = 5_000.0,
            ),
        )
    }
}
