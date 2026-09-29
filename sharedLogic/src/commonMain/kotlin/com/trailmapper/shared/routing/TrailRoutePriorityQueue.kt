/**
 * Job: Provide a small min-heap for common route search without platform collections.
 *
 */
package com.trailmapper.shared.routing

internal class TrailRoutePriorityQueue {
    private val entries = mutableListOf<TrailRouteQueueEntry>()

    fun push(entry: TrailRouteQueueEntry) {
        entries += entry
        siftUp(entries.lastIndex)
    }

    fun pop(): TrailRouteQueueEntry? {
        if (entries.isEmpty()) {
            return null
        }

        val first = entries.first()
        val last = entries.removeAt(entries.lastIndex)
        if (entries.isNotEmpty()) {
            entries[0] = last
            siftDown(0)
        }
        return first
    }

    private fun siftUp(startIndex: Int) {
        var index = startIndex
        while (index > 0) {
            val parentIndex = (index - 1) / 2
            if (entries[parentIndex].cost <= entries[index].cost) {
                return
            }
            entries.swap(parentIndex, index)
            index = parentIndex
        }
    }

    private fun siftDown(startIndex: Int) {
        var index = startIndex
        while (true) {
            val leftIndex = index * 2 + 1
            val rightIndex = leftIndex + 1
            var smallestIndex = index

            if (leftIndex < entries.size && entries[leftIndex].cost < entries[smallestIndex].cost) {
                smallestIndex = leftIndex
            }
            if (rightIndex < entries.size && entries[rightIndex].cost < entries[smallestIndex].cost) {
                smallestIndex = rightIndex
            }
            if (smallestIndex == index) {
                return
            }

            entries.swap(index, smallestIndex)
            index = smallestIndex
        }
    }

    private fun MutableList<TrailRouteQueueEntry>.swap(
        firstIndex: Int,
        secondIndex: Int,
    ) {
        val temporary = this[firstIndex]
        this[firstIndex] = this[secondIndex]
        this[secondIndex] = temporary
    }
}
