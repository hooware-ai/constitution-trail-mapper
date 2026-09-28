/**
 * Job: Verify current location is offered only where it makes route-planning sense.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CurrentLocationEndpointAvailabilitySijkoTest {
    @Test
    fun allowsCurrentLocationForStartOnly() {
        assertTrue(CurrentLocationEndpointAvailabilitySijko.isAvailableFor(RouteEndpointTarget.Start))
        assertFalse(CurrentLocationEndpointAvailabilitySijko.isAvailableFor(RouteEndpointTarget.Destination))
    }
}
