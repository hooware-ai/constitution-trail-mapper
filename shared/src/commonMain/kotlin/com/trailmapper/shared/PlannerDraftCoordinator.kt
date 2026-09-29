/**
 * Job: Serialize planner draft storage and let only the screen that owns a slot change it, when the change runs.
 *
 */
package com.trailmapper.shared

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Every draft read and write goes through one of these, one at a time and in order.
 *
 * - A save cancelled before its turn never runs, and a clear queued behind a save that is already writing
 *   waits for it, so a cleared draft cannot be revived.
 * - Each slot has one owner (the newest planner screen). Ownership is checked when the operation runs,
 *   not when it was requested, so a delayed save, clear or discard from an older screen (or from before an
 *   Activity was recreated) does nothing to what a newer screen has kept.
 * - There is one instance per process (see [forProcess]), so recreating the Activity keeps the same lock
 *   and the same owners.
 */
class PlannerDraftCoordinator(
    private val store: PlannerDraftStore,
) {
    private val lock = Mutex()
    private val owners = MutableStateFlow<Map<String, Any>>(emptyMap())

    suspend fun load(slot: String): String? = lock.withLock { store.load(slot) }

    /** The newest screen for a slot takes it over; the previous owner's later operations become no-ops. */
    fun claim(
        slot: String,
        owner: Any,
    ) {
        owners.update { current -> current + (slot to owner) }
    }

    suspend fun save(
        slot: String,
        owner: Any,
        serialized: String,
    ) {
        lock.withLock {
            currentCoroutineContext().ensureActive()
            if (owners.value[slot] === owner) {
                store.save(slot, serialized)
            }
        }
    }

    /** Clears the slot but keeps ownership, for a form that is empty again. */
    suspend fun clear(
        slot: String,
        owner: Any,
    ) {
        lock.withLock {
            if (owners.value[slot] === owner) {
                store.clear(slot)
            }
        }
    }

    /** The owner really left: clear the slot and give it up so nothing it still has queued can write. */
    suspend fun discard(
        slot: String,
        owner: Any,
    ) {
        lock.withLock {
            if (owners.value[slot] === owner) {
                store.clear(slot)
                owners.update { current -> current - slot }
            }
        }
    }

    companion object {
        private var processInstance: PlannerDraftCoordinator? = null

        /** Platforms without a draft store lose an unfinished form when the process dies, as before. */
        val None: PlannerDraftCoordinator = PlannerDraftCoordinator(NoPlannerDraftStore)

        internal fun resetProcessInstanceForTest() {
            processInstance = null
        }

        /** The one coordinator for this process; [createStore] runs only the first time. */
        fun forProcess(createStore: () -> PlannerDraftStore): PlannerDraftCoordinator {
            return processInstance ?: PlannerDraftCoordinator(createStore()).also { created ->
                processInstance = created
            }
        }
    }
}
