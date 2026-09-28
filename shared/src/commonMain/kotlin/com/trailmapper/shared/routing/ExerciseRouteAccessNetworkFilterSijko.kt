/**
 * Job: Keep exercise-route ordinary-road data within the area a target-distance loop can reach.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.max

object ExerciseRouteAccessNetworkFilterSijko {
    fun nearbyFeatures(
        features: List<AccessNetworkFeature>,
        startPoint: MapPoint,
        targetDistanceMeters: Double,
    ): List<AccessNetworkFeature> {
        val radiusMeters = max(
            MinimumRadiusMeters,
            targetDistanceMeters * TargetDistanceRadiusRatio,
        )
        val startPoints = listOf(startPoint)
        return features.filter { feature ->
            AccessNetworkFeatureProximitySijko.isNearAnyPoint(
                feature = feature,
                points = startPoints,
                maxDistanceMeters = radiusMeters,
            )
        }
    }

    private const val MinimumRadiusMeters = 2_000.0
    private const val TargetDistanceRadiusRatio = 0.80
}
