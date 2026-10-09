/**
 * Job: Verify the common route-search priority queue returns lowest-cost nodes first.
 *
 */
package com.trailmapper.shared.routing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TrailRoutePriorityQueueTest {
    @Test
    fun popsEntriesByLowestCost() {
        val queue = TrailRoutePriorityQueue()

        queue.push(TrailRouteQueueEntry(nodeId = 1, cost = 30.0))
        queue.push(TrailRouteQueueEntry(nodeId = 2, cost = 10.0))
        queue.push(TrailRouteQueueEntry(nodeId = 3, cost = 20.0))

        assertEquals(2, queue.pop()?.nodeId)
        assertEquals(3, queue.pop()?.nodeId)
        assertEquals(1, queue.pop()?.nodeId)
        assertNull(queue.pop())
    }
}
