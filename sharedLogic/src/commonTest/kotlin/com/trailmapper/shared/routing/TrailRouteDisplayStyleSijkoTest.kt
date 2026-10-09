/**
 * Job: Verify normalized trail attributes map to the official route-map legend styles.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals

class TrailRouteDisplayStyleSijkoTest {
    @Test
    fun mapsConstitutionBranchNamesToLegendStyles() {
        assertEquals(
            TrailRouteDisplayStyle.BloomerLine,
            TrailRouteDisplayStyleSijko.styleFor(feature(name = "Bloomer Line")),
        )
        assertEquals(
            TrailRouteDisplayStyle.Route66IllinoisCentral,
            TrailRouteDisplayStyleSijko.styleFor(feature(name = "Route 66 & Illinois Central")),
        )
        assertEquals(
            TrailRouteDisplayStyle.Southtown,
            TrailRouteDisplayStyleSijko.styleFor(feature(name = "Southtown")),
        )
    }

    @Test
    fun proposedStatusOverridesBranchName() {
        assertEquals(
            TrailRouteDisplayStyle.Proposed,
            TrailRouteDisplayStyleSijko.styleFor(
                feature(
                    name = "Southtown",
                    status = TrailFeatureStatus.Proposed,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.ProposedTrails),
                ),
            ),
        )
    }

    @Test
    fun mapsRoleFallbacksToConnectorAndSharedRoadwayStyles() {
        assertEquals(
            TrailRouteDisplayStyle.ParkTrailConnectors,
            TrailRouteDisplayStyleSijko.styleFor(
                feature(
                    name = null,
                    routeRoles = setOf(TrailNetworkRole.ParkConnectors),
                ),
            ),
        )
        assertEquals(
            TrailRouteDisplayStyle.SuggestedSharedRoadways,
            TrailRouteDisplayStyleSijko.styleFor(
                feature(
                    name = null,
                    routeRoles = setOf(TrailNetworkRole.SharedRoadways),
                ),
            ),
        )
    }

    private fun feature(
        name: String?,
        status: TrailFeatureStatus = TrailFeatureStatus.Existing,
        routeRoles: Set<TrailNetworkRole> = setOf(TrailNetworkRole.TrailBranches),
    ): TrailNetworkFeature {
        return TrailNetworkFeature(
            id = "feature",
            name = name,
            status = status,
            routeRoles = routeRoles,
            paths = listOf(
                listOf(
                    MapPoint(latitude = 40.0, longitude = -89.0),
                    MapPoint(latitude = 40.0, longitude = -88.999),
                ),
            ),
        )
    }
}
