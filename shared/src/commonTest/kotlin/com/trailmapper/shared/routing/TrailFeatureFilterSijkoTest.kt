/**
 * Job: Verify route-layer selections include only approved trail-network features.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import com.trailmapper.shared.sijko.RouteLayerSelection
import kotlin.test.Test
import kotlin.test.assertEquals

class TrailFeatureFilterSijkoTest {
    @Test
    fun excludesProposedTrailsByDefault() {
        val existing = feature(
            id = "existing",
            status = TrailFeatureStatus.Existing,
            roles = setOf(TrailNetworkRole.TrailBranches),
        )
        val proposed = feature(
            id = "proposed",
            status = TrailFeatureStatus.Proposed,
            roles = setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.ProposedTrails),
        )

        val enabled = TrailFeatureFilterSijko.enabledFeatures(
            features = listOf(existing, proposed),
            selection = RouteLayerDefaultsSijko.defaultSelection(),
        )

        assertEquals(listOf(existing), enabled)
    }

    @Test
    fun includesProposedTrailsWhenExplicitlyEnabled() {
        val proposed = feature(
            id = "proposed",
            status = TrailFeatureStatus.Proposed,
            roles = setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.ProposedTrails),
        )

        val enabled = TrailFeatureFilterSijko.enabledFeatures(
            features = listOf(proposed),
            selection = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = true),
        )

        assertEquals(listOf(proposed), enabled)
    }

    @Test
    fun honorsDisabledLayerSelections() {
        val sharedRoadway = feature(
            id = "shared",
            roles = setOf(TrailNetworkRole.SharedRoadways),
        )

        val enabled = TrailFeatureFilterSijko.enabledFeatures(
            features = listOf(sharedRoadway),
            selection = RouteLayerSelection(
                trailBranches = true,
                parkConnectors = true,
                sharedRoadways = false,
                proposedTrails = false,
            ),
        )

        assertEquals(emptyList(), enabled)
    }

    private fun feature(
        id: String,
        status: TrailFeatureStatus = TrailFeatureStatus.Existing,
        roles: Set<TrailNetworkRole>,
    ): TrailNetworkFeature {
        return TrailNetworkFeature(
            id = id,
            status = status,
            routeRoles = roles,
            facilityType = TrailFacilityType.UrbanTrail,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
            paths = listOf(
                listOf(
                    MapPoint(latitude = 40.0, longitude = -89.0),
                    MapPoint(latitude = 40.0, longitude = -88.999),
                ),
            ),
        )
    }
}
