/**
 * Job: Verify shared-roadway distance is measured from final route edges.
 *
 */
package com.trailmapper.shared.routing

import kotlin.test.Test
import kotlin.test.assertEquals

class TrailRouteSharedRoadwayDistanceSijkoTest {
    @Test
    fun countsSharedRoadwayDistanceWithoutEndpointAccess() {
        val distance = TrailRouteSharedRoadwayDistanceSijko.distanceMeters(
            listOf(
                edge(
                    distanceMeters = 100.0,
                    ordinaryAccessDistanceMeters = 25.0,
                    routeRoles = setOf(TrailNetworkRole.SharedRoadways),
                ),
                edge(
                    distanceMeters = 50.0,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.SharedRoadways),
                ),
                edge(
                    distanceMeters = 200.0,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                ),
            ),
        )

        assertEquals(125.0, distance, absoluteTolerance = 0.001)
    }

    private fun edge(
        distanceMeters: Double,
        ordinaryAccessDistanceMeters: Double = 0.0,
        routeRoles: Set<TrailNetworkRole>,
    ): TrailGraphEdge {
        return TrailGraphEdge(
            id = 0,
            fromNodeId = 0,
            toNodeId = 1,
            distanceMeters = distanceMeters,
            ordinaryAccessDistanceMeters = ordinaryAccessDistanceMeters,
            routeRoles = routeRoles,
        )
    }
}
