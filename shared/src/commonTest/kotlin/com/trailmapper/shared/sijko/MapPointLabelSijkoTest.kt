/**
 * Job: Verify selected map points format into stable route endpoint labels.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class MapPointLabelSijkoTest {
    @Test
    fun formatsCoordinatesToFiveDecimalPlaces() {
        assertEquals(
            "Map point 40.49000, -88.98750",
            MapPointLabelSijko.labelFor(MapPoint(latitude = 40.49, longitude = -88.9875)),
        )
    }

    @Test
    fun roundsCoordinates() {
        assertEquals(
            "Map point 40.12346, -88.76543",
            MapPointLabelSijko.labelFor(MapPoint(latitude = 40.123456, longitude = -88.765434)),
        )
    }

    @Test
    fun formatsCoordinatesWithoutSpacesForUrls() {
        assertEquals(
            "40.49000,-88.98750",
            MapPointLabelSijko.coordinateTextFor(MapPoint(latitude = 40.49, longitude = -88.9875)),
        )
    }
}
