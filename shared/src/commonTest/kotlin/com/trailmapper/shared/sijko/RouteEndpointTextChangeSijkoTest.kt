/**
 * Job: Verify manually editing endpoint text clears stale coordinate selections.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class RouteEndpointTextChangeSijkoTest {
    @Test
    fun updatesStartTextAndClearsStartPoint() {
        val destinationPoint = MapPoint(latitude = 40.51, longitude = -88.98)
        val updated = RouteEndpointTextChangeSijko.updateText(
            endpoints = RouteEndpoints(
                start = "Old",
                destination = "Library",
                startPoint = MapPoint(latitude = 40.49, longitude = -88.99),
                destinationPoint = destinationPoint,
            ),
            target = RouteEndpointTarget.Start,
            text = "New start",
        )

        assertEquals(
            RouteEndpoints(
                start = "New start",
                destination = "Library",
                destinationPoint = destinationPoint,
            ),
            updated,
        )
    }

    @Test
    fun updatesDestinationTextAndClearsDestinationPoint() {
        val startPoint = MapPoint(latitude = 40.49, longitude = -88.99)
        val updated = RouteEndpointTextChangeSijko.updateText(
            endpoints = RouteEndpoints(
                start = "Home",
                destination = "Old",
                startPoint = startPoint,
                destinationPoint = MapPoint(latitude = 40.51, longitude = -88.98),
            ),
            target = RouteEndpointTarget.Destination,
            text = "New destination",
        )

        assertEquals(
            RouteEndpoints(
                start = "Home",
                destination = "New destination",
                startPoint = startPoint,
            ),
            updated,
        )
    }
}
