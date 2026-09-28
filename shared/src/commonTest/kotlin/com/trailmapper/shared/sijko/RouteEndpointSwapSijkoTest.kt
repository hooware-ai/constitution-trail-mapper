/**
 * Job: Verify route endpoint swapping preserves all entered start and destination values.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class RouteEndpointSwapSijkoTest {
    @Test
    fun swapsStartAndDestination() {
        val startPoint = MapPoint(latitude = 40.49, longitude = -88.99)
        val destinationPoint = MapPoint(latitude = 40.51, longitude = -88.98)
        val swapped = RouteEndpointSwapSijko.swap(
            RouteEndpoints(
                start = "Home",
                destination = "Library",
                startPoint = startPoint,
                destinationPoint = destinationPoint,
            ),
        )

        assertEquals(
            RouteEndpoints(
                start = "Library",
                destination = "Home",
                startPoint = destinationPoint,
                destinationPoint = startPoint,
            ),
            swapped,
        )
    }

    @Test
    fun preservesBlankEndpointValues() {
        val swapped = RouteEndpointSwapSijko.swap(
            RouteEndpoints(start = "", destination = "Library"),
        )

        assertEquals(RouteEndpoints(start = "Library", destination = ""), swapped)
    }
}
