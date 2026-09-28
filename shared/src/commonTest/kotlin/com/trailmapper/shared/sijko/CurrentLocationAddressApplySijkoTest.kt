/**
 * Job: Verify resolved current-location addresses are applied only to allowed endpoints.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class CurrentLocationAddressApplySijkoTest {
    @Test
    fun appliesResolvedAddressToSelectedStartEndpoint() {
        val point = MapPoint(latitude = 40.49, longitude = -88.99)
        val updated = CurrentLocationAddressApplySijko.applyAddress(
            endpoints = RouteEndpoints(start = "", destination = "Library"),
            target = RouteEndpointTarget.Start,
            address = "100 Main St",
            point = point,
        )

        assertEquals(
            RouteEndpoints(
                start = "100 Main St",
                destination = "Library",
                startPoint = point,
            ),
            updated,
        )
    }

    @Test
    fun ignoresResolvedAddressForDestinationEndpoint() {
        val point = MapPoint(latitude = 40.49, longitude = -88.99)
        val endpoints = RouteEndpoints(start = "Home", destination = "")
        val updated = CurrentLocationAddressApplySijko.applyAddress(
            endpoints = endpoints,
            target = RouteEndpointTarget.Destination,
            address = "100 Main St",
            point = point,
        )

        assertEquals(endpoints, updated)
    }

    @Test
    fun ignoresBlankResolvedAddress() {
        val endpoints = RouteEndpoints(start = "Home", destination = "Library")

        assertEquals(
            endpoints,
            CurrentLocationAddressApplySijko.applyAddress(
                endpoints = endpoints,
                target = RouteEndpointTarget.Start,
                address = "   ",
            ),
        )
    }
}
