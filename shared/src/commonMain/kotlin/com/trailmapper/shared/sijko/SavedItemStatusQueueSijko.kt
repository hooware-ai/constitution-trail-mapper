/**
 * Job: Hold Home's brief status messages so each one is shown once, in order, without replacing another.
 *
 */
package com.trailmapper.shared.sijko

data class SavedItemStatusMessage(
    val id: Long,
    val text: String,
)

/** Every message gets its own id, so two with the same words are still two messages. */
data class SavedItemStatusQueue(
    val messages: List<SavedItemStatusMessage> = emptyList(),
    private val nextId: Long = 0,
) {
    val current: SavedItemStatusMessage? get() = messages.firstOrNull()

    fun enqueue(text: String): SavedItemStatusQueue =
        copy(messages = messages + SavedItemStatusMessage(nextId, text), nextId = nextId + 1)

    /** Queues each message that is present, save results before destination results. */
    fun enqueueAll(vararg texts: String?): SavedItemStatusQueue =
        texts.filterNotNull().fold(this) { queue, text -> queue.enqueue(text) }

    /** Called once a message has been shown; only that message leaves the queue. */
    fun complete(id: Long): SavedItemStatusQueue =
        copy(messages = messages.filterNot { message -> message.id == id })
}
