/**
 * Job: Build endpoint access records from estimated or routed access geometry.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object TrailRouteEndpointAccessSijko {
    fun estimated(
        endpointPoint: MapPoint,
        snap: TrailNetworkSnap,
    ): TrailRouteEndpointAccess {
        val segments = TrailRouteSegmentMergeSijko.merge(
            listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(endpointPoint, snap.projectedPoint),
                    isRouted = false,
                ),
            ),
        )
        return TrailRouteEndpointAccess(
            endpointPoint = endpointPoint,
            snap = snap,
            accessSegments = segments,
            accessDistanceMeters = snap.accessDistanceMeters,
        )
    }

    fun routed(
        endpointPoint: MapPoint,
        snap: TrailNetworkSnap,
        accessRoute: TrailRoute,
    ): TrailRouteEndpointAccess {
        return TrailRouteEndpointAccess(
            endpointPoint = endpointPoint,
            snap = snap,
            accessSegments = accessRoute.segments,
            accessDistanceMeters = accessRoute.totalDistanceMeters,
        )
    }
}
