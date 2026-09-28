/**
 * Job: Verify route search is enabled only when both endpoints contain nonblank text.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RouteSearchAvailabilitySijkoTest {
    @Test
    fun allowsSearchWhenBothEndpointsAreNonBlank() {
        assertTrue(
            RouteSearchAvailabilitySijko.canSearch(
                RouteEndpoints(start = "Home", destination = "Library"),
            ),
        )
    }

    @Test
    fun rejectsMissingOrWhitespaceEndpoints() {
        assertFalse(RouteSearchAvailabilitySijko.canSearch(RouteEndpoints()))
        assertFalse(RouteSearchAvailabilitySijko.canSearch(RouteEndpoints(start = "Home")))
        assertFalse(RouteSearchAvailabilitySijko.canSearch(RouteEndpoints(destination = "Library")))
        assertFalse(
            RouteSearchAvailabilitySijko.canSearch(
                RouteEndpoints(start = "   ", destination = "Library"),
            ),
        )
    }
}
