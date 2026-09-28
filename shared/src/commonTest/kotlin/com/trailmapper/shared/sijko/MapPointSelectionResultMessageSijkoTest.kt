/**
 * Job: Verify map-point picker results map to the expected user-facing messages.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.MapPointSelectionResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MapPointSelectionResultMessageSijkoTest {
    @Test
    fun successAndCancellationHaveNoErrorMessage() {
        assertNull(
            MapPointSelectionResultMessageSijko.messageFor(
                MapPointSelectionResult.Success(MapPoint(latitude = 40.49, longitude = -88.9875)),
            ),
        )
        assertNull(MapPointSelectionResultMessageSijko.messageFor(MapPointSelectionResult.Cancelled))
    }

    @Test
    fun unavailableMapsToUserFacingMessage() {
        assertEquals(
            "Map point selection is not available.",
            MapPointSelectionResultMessageSijko.messageFor(MapPointSelectionResult.Unavailable),
        )
    }

    @Test
    fun preservesCustomErrorsAndFallsBackForBlankMessages() {
        assertEquals(
            "Picker failed",
            MapPointSelectionResultMessageSijko.messageFor(
                MapPointSelectionResult.Error("Picker failed"),
            ),
        )
        assertEquals(
            "Unable to choose a map point.",
            MapPointSelectionResultMessageSijko.messageFor(MapPointSelectionResult.Error("")),
        )
    }
}
