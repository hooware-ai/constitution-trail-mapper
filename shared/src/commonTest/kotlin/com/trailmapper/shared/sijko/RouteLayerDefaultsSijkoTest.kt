/**
 * Job: Verify the default route-layer selection keeps proposed trails disabled.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class RouteLayerDefaultsSijkoTest {
    @Test
    fun defaultsToApprovedLayersOnly() {
        assertEquals(
            RouteLayerSelection(
                trailBranches = true,
                parkConnectors = true,
                sharedRoadways = true,
                proposedTrails = false,
            ),
            RouteLayerDefaultsSijko.defaultSelection(),
        )
    }
}
