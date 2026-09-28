/**
 * Job: Verify saved-item title edits are trimmed without accepting blank names.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SavedItemTitleEditSijkoTest {
    @Test
    fun trimsSurroundingWhitespace() {
        assertEquals(
            "Saturday trail ride",
            SavedItemTitleEditSijko.normalizedTitle("  Saturday trail ride  "),
        )
    }

    @Test
    fun preservesInternalWhitespace() {
        assertEquals(
            "Route   with spacing",
            SavedItemTitleEditSijko.normalizedTitle("Route   with spacing"),
        )
    }

    @Test
    fun rejectsEmptyAndWhitespaceOnlyTitles() {
        assertNull(SavedItemTitleEditSijko.normalizedTitle(""))
        assertNull(SavedItemTitleEditSijko.normalizedTitle(" \t\n "))
    }
}
