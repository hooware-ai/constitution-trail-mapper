/**
 * Job: Calculate stable padded bounds that keep a shared trail route and its endpoint markers visible.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.max

object TrailRouteShareViewportSijko {
    fun viewportFor(points: List<MapPoint>): TrailRouteShareViewport? {
        val validPoints = points.filter { point ->
            point.latitude.isFinite() &&
                point.longitude.isFinite() &&
                point.latitude in MINIMUM_LATITUDE..MAXIMUM_LATITUDE &&
                point.longitude in MINIMUM_LONGITUDE..MAXIMUM_LONGITUDE
        }
        if (validPoints.isEmpty()) {
            return null
        }

        val minimumLatitude = validPoints.minOf(MapPoint::latitude)
        val maximumLatitude = validPoints.maxOf(MapPoint::latitude)
        val minimumLongitude = validPoints.minOf(MapPoint::longitude)
        val maximumLongitude = validPoints.maxOf(MapPoint::longitude)
        val latitudeCenter = (minimumLatitude + maximumLatitude) / 2.0
        val longitudeCenter = (minimumLongitude + maximumLongitude) / 2.0
        val latitudeSpan = max(maximumLatitude - minimumLatitude, MINIMUM_SPAN_DEGREES)
        val longitudeSpan = max(maximumLongitude - minimumLongitude, MINIMUM_SPAN_DEGREES)
        val latitudeHalfSpan = latitudeSpan * (0.5 + PADDING_FRACTION)
        val longitudeHalfSpan = longitudeSpan * (0.5 + PADDING_FRACTION)

        return TrailRouteShareViewport(
            southLatitude = (latitudeCenter - latitudeHalfSpan).coerceAtLeast(MINIMUM_LATITUDE),
            westLongitude = (longitudeCenter - longitudeHalfSpan).coerceAtLeast(MINIMUM_LONGITUDE),
            northLatitude = (latitudeCenter + latitudeHalfSpan).coerceAtMost(MAXIMUM_LATITUDE),
            eastLongitude = (longitudeCenter + longitudeHalfSpan).coerceAtMost(MAXIMUM_LONGITUDE),
        )
    }

    private const val PADDING_FRACTION = 0.08
    private const val MINIMUM_SPAN_DEGREES = 0.002
    private const val MINIMUM_LATITUDE = -85.0
    private const val MAXIMUM_LATITUDE = 85.0
    private const val MINIMUM_LONGITUDE = -180.0
    private const val MAXIMUM_LONGITUDE = 180.0
}
