/**
 * Job: Decide whether saved-card edit motion may run for the active duration scale.
 *
 */
package com.trailmapper.shared.sijko

object SavedItemEditMotionAvailabilitySijko {
    fun shouldAnimate(durationScale: Float?): Boolean =
        durationScale == null || durationScale > 0f
}
