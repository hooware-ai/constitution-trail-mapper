/**
 * Job: Verify selected map points update the correct route endpoint field.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class MapPointApplySijkoTest {
    @Test
    fun appliesMapPointToStartEndpoint() {
        val point = MapPoint(latitude = 40.49, longitude = -88.9875)
        val updated = MapPointApplySijko.applyMapPoint(
            endpoints = RouteEndpoints(start = "", destination = "Library"),
            target = RouteEndpointTarget.Start,
            point = point,
        )

        assertEquals(
            RouteEndpoints(
                start = "Map point 40.49000, -88.98750",
                destination = "Library",
                startPoint = point,
            ),
            updated,
        )
    }

    @Test
    fun appliesMapPointToDestinationEndpoint() {
        val point = MapPoint(latitude = 40.49, longitude = -88.9875)
        val updated = MapPointApplySijko.applyMapPoint(
            endpoints = RouteEndpoints(start = "Home", destination = ""),
            target = RouteEndpointTarget.Destination,
            point = point,
        )

        assertEquals(
            RouteEndpoints(
                start = "Home",
                destination = "Map point 40.49000, -88.98750",
                destinationPoint = point,
            ),
            updated,
        )
    }

    @Test
    fun appliesResolvedAddressWhenAvailable() {
        val point = MapPoint(latitude = 40.49, longitude = -88.9875)
        val updated = MapPointApplySijko.applyMapPoint(
            endpoints = RouteEndpoints(start = "", destination = "Library"),
            target = RouteEndpointTarget.Start,
            point = point,
            address = "100 N Main St, Bloomington, IL 61701",
        )

        assertEquals(
            RouteEndpoints(
                start = "100 N Main St, Bloomington, IL 61701",
                destination = "Library",
                startPoint = point,
            ),
            updated,
        )
    }

    @Test
    fun fallsBackToCoordinateLabelWhenResolvedAddressIsBlank() {
        val point = MapPoint(latitude = 40.49, longitude = -88.9875)
        val updated = MapPointApplySijko.applyMapPoint(
            endpoints = RouteEndpoints(start = "Home", destination = ""),
            target = RouteEndpointTarget.Destination,
            point = point,
            address = "",
        )

        assertEquals(
            RouteEndpoints(
                start = "Home",
                destination = "Map point 40.49000, -88.98750",
                destinationPoint = point,
            ),
            updated,
        )
    }
}
