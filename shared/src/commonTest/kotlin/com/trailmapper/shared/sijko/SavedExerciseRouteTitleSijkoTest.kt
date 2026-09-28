/**
 * Job: Verify generated exercise-route titles are stable and one-based.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class SavedExerciseRouteTitleSijkoTest {
    @Test
    fun createsOneBasedExerciseRouteTitles() {
        assertEquals("Exercise route 1", SavedExerciseRouteTitleSijko.titleFor(0))
        assertEquals("Exercise route 4", SavedExerciseRouteTitleSijko.titleFor(3))
    }
}
