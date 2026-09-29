/**
 * Job: Decide when a planner restores its draft and who may discard it, so races never lose or revive a form.
 *
 */
package com.trailmapper.shared

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * One planner screen's link to its draft. It restores only when the screen was recreated after the process
 * was killed, then [settle]s the ViewModel so no later restore can overwrite what the rider has done since.
 */
@Stable
internal class PlannerDraftSession(
    private val slot: String,
    private val store: PlannerDraftStore,
    private val recreated: Boolean,
    private val restore: (String) -> Unit,
    private val settle: () -> Unit,
) {
    var ready by mutableStateOf(false)
        private set

    /**
     * Safe to start again if cancelled part way (an effect restart): nothing is remembered until the load
     * has finished, and [ready] only becomes true then, so saving never starts on a half-restored form.
     */
    suspend fun restoreIfRecreated() {
        if (ready) return
        if (recreated) {
            store.load(slot)?.let(restore)
        }
        settle()
        ready = true
    }
}

/** Which planner screen currently owns each draft slot, so a late discard from an older screen does nothing. */
internal object PlannerDraftOwnership {
    private val owners = mutableMapOf<String, Any>()

    fun claim(
        slot: String,
        owner: Any,
    ) {
        owners[slot] = owner
    }

    /** True when [owner] still owned the slot, which it no longer does once a newer screen claimed it. */
    fun release(
        slot: String,
        owner: Any,
    ): Boolean {
        if (owners[slot] !== owner) return false
        owners.remove(slot)
        return true
    }
}

/**
 * Runs each read and write one at a time, in order. A save that was cancelled before its turn never
 * runs, and a clear queued behind a save that is already writing waits for it, so an abandoned draft
 * cannot come back after it was cleared.
 */
class SerializedPlannerDraftStore(
    private val delegate: PlannerDraftStore,
) : PlannerDraftStore {
    private val lock = Mutex()

    override suspend fun load(slot: String): String? = lock.withLock { delegate.load(slot) }

    override suspend fun save(
        slot: String,
        serialized: String,
    ) {
        lock.withLock {
            currentCoroutineContext().ensureActive()
            delegate.save(slot, serialized)
        }
    }

    override suspend fun clear(slot: String) {
        lock.withLock { delegate.clear(slot) }
    }
}
