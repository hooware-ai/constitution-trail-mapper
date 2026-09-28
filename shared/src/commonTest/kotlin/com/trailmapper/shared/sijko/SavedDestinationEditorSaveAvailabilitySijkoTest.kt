/**
 * Job: Verify manually saved destinations require a name, address text, and coordinates.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SavedDestinationEditorSaveAvailabilitySijkoTest {
    @Test
    fun allowsSaveWhenNameAddressAndPointExist() {
        assertTrue(
            SavedDestinationEditorSaveAvailabilitySijko.canSave(
                name = "Rivian",
                address = "100 Rivian Motorway, Normal, IL",
                point = MapPoint(latitude = 40.5, longitude = -88.9),
            ),
        )
    }

    @Test
    fun blocksSaveWithoutName() {
        assertFalse(
            SavedDestinationEditorSaveAvailabilitySijko.canSave(
                name = " ",
                address = "100 Rivian Motorway, Normal, IL",
                point = MapPoint(latitude = 40.5, longitude = -88.9),
            ),
        )
    }

    @Test
    fun blocksSaveWithoutRouteablePoint() {
        assertFalse(
            SavedDestinationEditorSaveAvailabilitySijko.canSave(
                name = "Rivian",
                address = "100 Rivian Motorway, Normal, IL",
                point = null,
            ),
        )
    }
}
