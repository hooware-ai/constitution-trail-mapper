/**
 * Job: Decide whether an access-network feature intersects a bounded area around route endpoints.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object AccessNetworkFeatureProximitySijko {
    fun isNearAnyPoint(
        feature: AccessNetworkFeature,
        points: List<MapPoint>,
        maxDistanceMeters: Double,
    ): Boolean {
        if (points.isEmpty() || maxDistanceMeters < 0.0 || !maxDistanceMeters.isFinite()) {
            return false
        }

        return points.any { point ->
            feature.paths.any { path ->
                path.any { pathPoint ->
                    TrailDistanceSijko.metersBetween(point, pathPoint) <= maxDistanceMeters
                } || path.windowed(size = 2, step = 1).any { segment ->
                    TrailDistanceSijko.projectToSegment(
                        point = point,
                        segmentStart = segment[0],
                        segmentEnd = segment[1],
                    ).distanceMeters <= maxDistanceMeters
                }
            }
        }
    }
}
