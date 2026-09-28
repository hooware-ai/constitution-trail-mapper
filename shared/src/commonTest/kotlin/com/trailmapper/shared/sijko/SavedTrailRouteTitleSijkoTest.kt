/**
 * Job: Verify generated saved-route titles are stable and one-based.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class SavedTrailRouteTitleSijkoTest {
    @Test
    fun createsOneBasedSavedRouteTitles() {
        assertEquals("Saved route 1", SavedTrailRouteTitleSijko.titleFor(0))
        assertEquals("Saved route 4", SavedTrailRouteTitleSijko.titleFor(3))
    }
}
