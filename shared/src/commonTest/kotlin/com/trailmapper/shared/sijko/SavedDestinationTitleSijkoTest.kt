/**
 * Job: Verify saved destination titles are concise but never blank.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class SavedDestinationTitleSijkoTest {
    @Test
    fun usesTrimmedCustomNameBeforeAddress() {
        assertEquals(
            "Work",
            SavedDestinationTitleSijko.titleFor(
                address = "100 Rivian Motorway, Normal, IL 61761, USA",
                savedDestinationCount = 3,
                customName = " Work ",
            ),
        )
    }

    @Test
    fun usesFirstAddressPartAsTitle() {
        assertEquals(
            "100 Rivian Motorway",
            SavedDestinationTitleSijko.titleFor(
                address = "100 Rivian Motorway, Normal, IL 61761, USA",
                savedDestinationCount = 3,
            ),
        )
    }

    @Test
    fun fallsBackToOneBasedSavedDestinationTitle() {
        assertEquals(
            "Saved destination 4",
            SavedDestinationTitleSijko.titleFor(
                address = "   ",
                savedDestinationCount = 3,
            ),
        )
    }
}
