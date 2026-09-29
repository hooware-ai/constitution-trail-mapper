/**
 * Job: Decide when a planner restores its draft and who may discard it, so races never lose or revive a form.
 *
 */
package com.trailmapper.shared

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * One planner screen's link to its draft. It restores only when the screen was recreated after the process
 * was killed, then [settle]s the ViewModel so no later restore can overwrite what the rider has done since.
 */
@Stable
internal class PlannerDraftSession(
    val slot: String,
    private val coordinator: PlannerDraftCoordinator,
    private val recreated: Boolean,
    private val restore: (String) -> Unit,
    private val settle: () -> Unit,
) {
    var ready by mutableStateOf(false)
        private set

    init {
        // The newest screen owns the slot; anything an older screen still has queued becomes a no-op.
        coordinator.claim(slot, this)
    }

    suspend fun save(serialized: String) = coordinator.save(slot, this, serialized)

    suspend fun clear() = coordinator.clear(slot, this)

    suspend fun discard() = coordinator.discard(slot, this)

    /**
     * Safe to start again if cancelled part way (an effect restart): nothing is remembered until the load
     * has finished, and [ready] only becomes true then, so saving never starts on a half-restored form.
     */
    suspend fun restoreIfRecreated() {
        if (ready) return
        if (recreated) {
            coordinator.load(slot)?.let(restore)
        }
        settle()
        ready = true
    }
}
