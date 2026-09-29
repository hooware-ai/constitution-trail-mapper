/**
 * Job: Verify role-level route costs prefer trail infrastructure over shared roadways.
 *
 */
package com.trailmapper.shared.routing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailRouteRoleCostSijkoTest {
    @Test
    fun sharedRoadwayCostsMoreThanTrailBranch() {
        val trailCost = TrailRouteRoleCostSijko.multiplier(setOf(TrailNetworkRole.TrailBranches))
        val sharedRoadwayCost = TrailRouteRoleCostSijko.multiplier(setOf(TrailNetworkRole.SharedRoadways))

        assertTrue(sharedRoadwayCost > trailCost)
    }

    @Test
    fun parkConnectorCountsAsTrailInfrastructure() {
        val trailCost = TrailRouteRoleCostSijko.multiplier(setOf(TrailNetworkRole.TrailBranches))
        val parkConnectorCost = TrailRouteRoleCostSijko.multiplier(setOf(TrailNetworkRole.ParkConnectors))

        assertEquals(trailCost, parkConnectorCost)
    }

    @Test
    fun sharedRoadwayRoleWinsWhenFeatureAlsoHasTrailBranchRole() {
        val trailCost = TrailRouteRoleCostSijko.multiplier(setOf(TrailNetworkRole.TrailBranches))
        val mixedRoleCost = TrailRouteRoleCostSijko.multiplier(
            setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.SharedRoadways),
        )

        assertTrue(mixedRoleCost > trailCost)
    }
}
