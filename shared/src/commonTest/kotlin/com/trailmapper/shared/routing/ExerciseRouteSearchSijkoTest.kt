/**
 * Job: Verify the bounded exercise search keeps cheapest paths, respects its distance cap, and stays cancellable.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ExerciseRouteSearchSijkoTest {
    @Test
    fun cheapestPathWinsWhenItFitsTheCap() {
        val tree = search(maximumPhysicalDistanceMeters = 1_200.0)

        val path = assertNotNull(ExerciseRouteSearchSijko.pathTo(tree, 3))
        assertEquals(listOf(0, 3), path.edges.map { it.id })
        assertEquals(1_100.0, path.totalDistanceMeters)
        assertEquals(1_100.0, path.totalCost)
    }

    @Test
    fun distanceCapStillExcludesNodesBeyondTheShortestFeasiblePath() {
        val tree = search(maximumPhysicalDistanceMeters = 700.0)

        assertNull(ExerciseRouteSearchSijko.pathTo(tree, 3))
        assertTrue(tree.physicalDistancesMeters.values.all { it <= 700.0 })
    }

    @Test
    fun reconstructedPathsFollowTheirOwnLabelChain() {
        val tree = search(maximumPhysicalDistanceMeters = 1_000.0)

        val cheapestToOne = assertNotNull(ExerciseRouteSearchSijko.pathTo(tree, 1))
        val shortestThroughOne = assertNotNull(ExerciseRouteSearchSijko.pathTo(tree, 3))
        assertEquals(listOf(0), cheapestToOne.edges.map { it.id })
        assertEquals(listOf(1, 2, 3), shortestThroughOne.edges.map { it.id })
        assertEquals(listOf(0, 2, 1, 3), shortestThroughOne.edges.flatMap { listOf(it.fromNodeId, it.toNodeId) }.distinct())
    }

    @Test
    fun cancellationCheckpointPropagates() {
        assertFailsWith<CancellationException> {
            search(maximumPhysicalDistanceMeters = 1_000.0) { throw CancellationException("cancelled") }
        }
    }

    // 0 -> 1 is cheap but 600 m; 0 -> 2 -> 1 costs more but is 300 m; 1 -> 3 is the only last leg (500 m).
    private fun search(
        maximumPhysicalDistanceMeters: Double,
        cancellationCheckpoint: () -> Unit = {},
    ): ExerciseRouteSearchTree {
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
        return ExerciseRouteSearchSijko.searchTree(
            adjacency = ExerciseRouteSearchSijko.adjacencyFor(graph),
            startNodeId = 0,
            edgeCost = { if (it.id == 1 || it.id == 2) 500.0 else it.distanceMeters },
            maximumPhysicalDistanceMeters = maximumPhysicalDistanceMeters,
            cancellationCheckpoint = cancellationCheckpoint,
        )
    }
}
