/**
 * Job: Verify simultaneous status messages are each delivered exactly once, in order.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SavedItemStatusQueueSijkoTest {
    @Test
    fun deliversBothPendingMessagesOnceInOrder() {
        var queue = SavedItemStatusQueue().enqueueAll("Unable to load saved routes.", "Unable to load saved destinations.")

        val delivered = drain(queue)

        assertEquals(listOf("Unable to load saved routes.", "Unable to load saved destinations."), delivered)
    }

    @Test
    fun aMessageArrivingWhileAnotherShowsWaitsItsTurn() {
        var queue = SavedItemStatusQueue().enqueue("Test Park saved.")
        val first = queue.current!!
        queue = queue.enqueue("Route renamed.")

        assertEquals("Test Park saved.", queue.current?.text)
        queue = queue.complete(first.id)

        assertEquals("Route renamed.", queue.current?.text)
        assertNull(queue.complete(queue.current!!.id).current)
    }

    @Test
    fun identicalTextsAreStillTwoMessages() {
        val queue = SavedItemStatusQueue().enqueue("Unable to save.").enqueue("Unable to save.")

        assertEquals(listOf("Unable to save.", "Unable to save."), drain(queue))
    }

    @Test
    fun skipsMessagesThatAreNotPending() {
        assertEquals(listOf("Only destination."), drain(SavedItemStatusQueue().enqueueAll(null, "Only destination.")))
        assertNull(SavedItemStatusQueue().enqueueAll(null, null).current)
    }

    @Test
    fun completingAnUnknownIdChangesNothing() {
        val queue = SavedItemStatusQueue().enqueue("A")

        assertEquals(queue, queue.complete(99))
    }

    private fun drain(start: SavedItemStatusQueue): List<String> {
        var queue = start
        val delivered = mutableListOf<String>()
        while (true) {
            val message = queue.current ?: return delivered
            delivered += message.text
            queue = queue.complete(message.id)
        }
    }
}
