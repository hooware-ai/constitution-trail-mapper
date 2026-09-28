/**
 * Job: Verify only proposed trails can be toggled while core route layers remain locked.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class RouteLayerToggleSijkoTest {
    @Test
    fun togglesOnlyProposedTrails() {
        val initial = RouteLayerDefaultsSijko.defaultSelection()
        val enabled = RouteLayerToggleSijko.setLayerChecked(
            selection = initial,
            layer = TrailRouteLayer.ProposedTrails,
            checked = true,
        )

        assertEquals(initial.copy(proposedTrails = true), enabled)
        assertEquals(
            initial,
            RouteLayerToggleSijko.setLayerChecked(
                selection = enabled,
                layer = TrailRouteLayer.ProposedTrails,
                checked = false,
            ),
        )
    }

    @Test
    fun leavesLockedLayersUnchanged() {
        val initial = RouteLayerDefaultsSijko.defaultSelection()

        assertEquals(
            initial,
            RouteLayerToggleSijko.setLayerChecked(
                selection = initial,
                layer = TrailRouteLayer.TrailBranches,
                checked = false,
            ),
        )
        assertEquals(
            initial,
            RouteLayerToggleSijko.setLayerChecked(
                selection = initial,
                layer = TrailRouteLayer.ParkConnectors,
                checked = false,
            ),
        )
        assertEquals(
            initial,
            RouteLayerToggleSijko.setLayerChecked(
                selection = initial,
                layer = TrailRouteLayer.SharedRoadways,
                checked = false,
            ),
        )
    }
}
