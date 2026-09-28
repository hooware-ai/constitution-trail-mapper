/**
 * Job: Verify saved-card motion honors disabled and invalid duration scales.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SavedItemEditMotionAvailabilitySijkoTest {
    @Test
    fun allowsMotionWhenNoPlatformScaleIsAvailable() {
        assertTrue(SavedItemEditMotionAvailabilitySijko.shouldAnimate(null))
    }

    @Test
    fun allowsPositiveDurationScales() {
        assertTrue(SavedItemEditMotionAvailabilitySijko.shouldAnimate(0.5f))
        assertTrue(SavedItemEditMotionAvailabilitySijko.shouldAnimate(1f))
        assertTrue(SavedItemEditMotionAvailabilitySijko.shouldAnimate(10f))
    }

    @Test
    fun rejectsDisabledAndInvalidDurationScales() {
        assertFalse(SavedItemEditMotionAvailabilitySijko.shouldAnimate(0f))
        assertFalse(SavedItemEditMotionAvailabilitySijko.shouldAnimate(-1f))
        assertFalse(SavedItemEditMotionAvailabilitySijko.shouldAnimate(Float.NaN))
    }
}
