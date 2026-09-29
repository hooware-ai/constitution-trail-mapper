/**
 * Job: Verify route search needs both endpoints resolved, and the form says what is missing.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RouteSearchAvailabilitySijkoTest {
    private val start = MapPoint(40.5, -88.9)
    private val destination = MapPoint(40.45, -88.95)

    @Test
    fun allowsSearchOnlyWhenBothEndpointsAreResolved() {
        assertTrue(
            RouteSearchAvailabilitySijko.canSearch(
                RouteEndpoints("Home", "Library", start, destination),
            ),
        )
    }

    @Test
    fun rejectsMissingUnresolvedOrWhitespaceEndpoints() {
        assertFalse(RouteSearchAvailabilitySijko.canSearch(RouteEndpoints()))
        assertFalse(RouteSearchAvailabilitySijko.canSearch(RouteEndpoints(start = "Home", destination = "Library")))
        assertFalse(RouteSearchAvailabilitySijko.canSearch(RouteEndpoints("Home", "Library", start, null)))
        assertFalse(RouteSearchAvailabilitySijko.canSearch(RouteEndpoints("Home", "Library", null, destination)))
        assertFalse(RouteSearchAvailabilitySijko.canSearch(RouteEndpoints("   ", "Library", start, destination)))
    }

    @Test
    fun typedTextThatIsNotResolvedGetsAHintForThatField() {
        val endpoints = RouteEndpoints(start = "Hershey", destination = "Library", destinationPoint = destination)

        assertEquals(
            "Choose a suggestion, your current location, or a point on the map so the route starts where you mean.",
            RouteSearchAvailabilitySijko.unresolvedHint(RouteEndpointTarget.Start, endpoints),
        )
        assertNull(RouteSearchAvailabilitySijko.unresolvedHint(RouteEndpointTarget.Destination, endpoints))
        assertEquals(
            "Choose a suggestion, your current location, or a point on the map so the route ends where you mean.",
            RouteSearchAvailabilitySijko.unresolvedHint(
                RouteEndpointTarget.Destination,
                RouteEndpoints(destination = "Library"),
            ),
        )
        assertNull(RouteSearchAvailabilitySijko.unresolvedHint(RouteEndpointTarget.Start, RouteEndpoints()))
    }

    @Test
    fun guidanceNamesTheFirstEmptyFieldAndClearsOnceBothHaveText() {
        assertEquals("Add a start to find a route.", RouteSearchAvailabilitySijko.guidance(RouteEndpoints()))
        assertEquals(
            "Add a destination to find a route.",
            RouteSearchAvailabilitySijko.guidance(RouteEndpoints(start = "Home")),
        )
        assertNull(RouteSearchAvailabilitySijko.guidance(RouteEndpoints(start = "Home", destination = "Library")))
    }
}
