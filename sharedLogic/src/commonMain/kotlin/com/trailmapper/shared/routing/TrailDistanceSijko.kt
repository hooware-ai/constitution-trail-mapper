/**
 * Job: Provide small-distance geographic measurements needed by the route engine.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

object TrailDistanceSijko {
    private const val EarthRadiusMeters = 6_371_008.8

    fun metersBetween(
        first: MapPoint,
        second: MapPoint,
    ): Double {
        val firstLatitude = first.latitude.toRadians()
        val secondLatitude = second.latitude.toRadians()
        val latitudeDelta = (second.latitude - first.latitude).toRadians()
        val longitudeDelta = (second.longitude - first.longitude).toRadians()
        val haversine = sin(latitudeDelta / 2.0) * sin(latitudeDelta / 2.0) +
            cos(firstLatitude) * cos(secondLatitude) *
            sin(longitudeDelta / 2.0) * sin(longitudeDelta / 2.0)
        return EarthRadiusMeters * 2.0 * atan2(sqrt(haversine), sqrt(1.0 - haversine))
    }

    fun pathLengthMeters(points: List<MapPoint>): Double {
        return points
            .windowed(size = 2, step = 1)
            .sumOf { (first, second) -> metersBetween(first, second) }
    }

    fun projectToSegment(
        point: MapPoint,
        segmentStart: MapPoint,
        segmentEnd: MapPoint,
    ): TrailSegmentProjection {
        val endX = longitudeDeltaMeters(
            longitude = segmentEnd.longitude,
            originLongitude = segmentStart.longitude,
            originLatitude = segmentStart.latitude,
        )
        val endY = latitudeDeltaMeters(
            latitude = segmentEnd.latitude,
            originLatitude = segmentStart.latitude,
        )
        val pointX = longitudeDeltaMeters(
            longitude = point.longitude,
            originLongitude = segmentStart.longitude,
            originLatitude = segmentStart.latitude,
        )
        val pointY = latitudeDeltaMeters(
            latitude = point.latitude,
            originLatitude = segmentStart.latitude,
        )

        val lengthSquared = endX * endX + endY * endY
        if (lengthSquared == 0.0) {
            return TrailSegmentProjection(
                projectedPoint = segmentStart,
                distanceMeters = metersBetween(point, segmentStart),
                distanceFromStartMeters = 0.0,
                distanceToEndMeters = 0.0,
            )
        }

        val unclampedT = (pointX * endX + pointY * endY) / lengthSquared
        val t = min(1.0, max(0.0, unclampedT))
        val projectedX = endX * t
        val projectedY = endY * t
        val projectedPoint = MapPoint(
            latitude = segmentStart.latitude + metersToLatitudeDelta(projectedY),
            longitude = segmentStart.longitude + metersToLongitudeDelta(
                meters = projectedX,
                originLatitude = segmentStart.latitude,
            ),
        )

        return TrailSegmentProjection(
            projectedPoint = projectedPoint,
            distanceMeters = sqrt(
                (pointX - projectedX) * (pointX - projectedX) +
                    (pointY - projectedY) * (pointY - projectedY),
            ),
            distanceFromStartMeters = sqrt(projectedX * projectedX + projectedY * projectedY),
            distanceToEndMeters = sqrt(
                (endX - projectedX) * (endX - projectedX) +
                    (endY - projectedY) * (endY - projectedY),
            ),
        )
    }

    /**
     * Projects onto the nearest leg of a polyline. Along-path distances follow every vertex, so a
     * point on a bent edge is not measured against the chord between the edge's endpoints.
     */
    fun projectToPolyline(
        point: MapPoint,
        points: List<MapPoint>,
    ): TrailSegmentProjection {
        require(points.isNotEmpty()) { "Cannot project onto an empty polyline." }
        if (points.size <= 2) {
            return projectToSegment(point, points.first(), points.last())
        }

        val totalMeters = pathLengthMeters(points)
        var best: TrailSegmentProjection? = null
        var legStartMeters = 0.0
        for (index in 0 until points.lastIndex) {
            val legStart = points[index]
            val legEnd = points[index + 1]
            val leg = projectToSegment(point, legStart, legEnd)
            val current = best
            if (current == null || leg.distanceMeters < current.distanceMeters) {
                val fromStartMeters = (legStartMeters + leg.distanceFromStartMeters).coerceAtMost(totalMeters)
                best = leg.copy(
                    distanceFromStartMeters = fromStartMeters,
                    distanceToEndMeters = totalMeters - fromStartMeters,
                )
            }
            legStartMeters += metersBetween(legStart, legEnd)
        }
        return requireNotNull(best)
    }

    /**
     * Returns the polyline's vertices lying strictly between two positions, given as fractions of its
     * length, ordered from [fromFraction] toward [toFraction].
     */
    fun verticesBetween(
        points: List<MapPoint>,
        fromFraction: Double,
        toFraction: Double,
    ): List<MapPoint> {
        if (points.size <= 2) {
            return emptyList()
        }
        val totalMeters = pathLengthMeters(points)
        if (totalMeters <= 0.0) {
            return emptyList()
        }
        val lowMeters = min(fromFraction, toFraction) * totalMeters + VertexEpsilonMeters
        val highMeters = max(fromFraction, toFraction) * totalMeters - VertexEpsilonMeters
        val between = mutableListOf<MapPoint>()
        var cumulativeMeters = 0.0
        points.forEachIndexed { index, vertex ->
            if (index > 0) {
                cumulativeMeters += metersBetween(points[index - 1], vertex)
            }
            if (cumulativeMeters > lowMeters && cumulativeMeters < highMeters) {
                between += vertex
            }
        }
        return if (fromFraction <= toFraction) between else between.reversed()
    }

    private const val VertexEpsilonMeters = 0.01

    private fun Double.toRadians(): Double = this * PI / 180.0

    private fun latitudeDeltaMeters(
        latitude: Double,
        originLatitude: Double,
    ): Double {
        return (latitude - originLatitude).toRadians() * EarthRadiusMeters
    }

    private fun longitudeDeltaMeters(
        longitude: Double,
        originLongitude: Double,
        originLatitude: Double,
    ): Double {
        return (longitude - originLongitude).toRadians() *
            EarthRadiusMeters *
            cos(originLatitude.toRadians())
    }

    private fun metersToLatitudeDelta(meters: Double): Double {
        return meters / EarthRadiusMeters * 180.0 / PI
    }

    private fun metersToLongitudeDelta(
        meters: Double,
        originLatitude: Double,
    ): Double {
        return meters / (EarthRadiusMeters * cos(originLatitude.toRadians())) * 180.0 / PI
    }
}
