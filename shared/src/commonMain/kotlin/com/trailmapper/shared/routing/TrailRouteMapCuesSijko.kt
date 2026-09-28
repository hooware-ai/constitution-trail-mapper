/**
 * Job: Turn a route's traversal shape into map cues for direction, second passes, turnarounds and progress.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sqrt

data class TrailRouteMapCuePiece(
    /** The geometry as drawn: a second pass is already offset to the right of travel. */
    val segment: TrailRouteSegment,
    /** True when this stretch repeats earlier travel. */
    val repeatsEarlierTravel: Boolean,
    /** Navigation distance along the route at each of [segment]'s points. */
    val distancesAlongRouteMeters: List<Double>,
)

data class TrailRouteMapCues(
    /** Every drawn piece, in route order and in the direction of travel. */
    val pieces: List<TrailRouteMapCuePiece>,
    val turnarounds: List<TrailRouteReversal>,
) {
    /** Pieces ridden for the first time. */
    val firstPass: List<TrailRouteSegment> = pieces.filterNot { it.repeatsEarlierTravel }.map { it.segment }

    /** Pieces that repeat earlier travel, offset so both passes stay visible. */
    val secondPass: List<TrailRouteSegment> = pieces.filter { it.repeatsEarlierTravel }.map { it.segment }

    val hasTraversalCues: Boolean get() = secondPass.isNotEmpty() || turnarounds.isNotEmpty()

    /**
     * The drawn geometry already ridden at [progressMeters], measured on navigation's distance basis.
     * A ridden second pass follows its offset line, so the overlay covers the line the rider sees.
     * Each list is one continuous polyline.
     */
    fun riddenPolylines(progressMeters: Double): List<List<MapPoint>> {
        if (progressMeters <= 0.0) {
            return emptyList()
        }
        return pieces.mapNotNull { piece ->
            val points = piece.segment.points
            val distances = piece.distancesAlongRouteMeters
            if (distances.first() >= progressMeters) {
                return@mapNotNull null
            }
            val ridden = mutableListOf(points.first())
            for (index in 1..points.lastIndex) {
                if (distances[index] <= progressMeters) {
                    ridden += points[index]
                    continue
                }
                val ratio = (progressMeters - distances[index - 1]) / (distances[index] - distances[index - 1])
                val from = points[index - 1]
                val to = points[index]
                ridden += MapPoint(
                    latitude = from.latitude + (to.latitude - from.latitude) * ratio,
                    longitude = from.longitude + (to.longitude - from.longitude) * ratio,
                )
                break
            }
            ridden.takeIf { it.size >= 2 }
        }
    }
}

object TrailRouteMapCuesSijko {
    fun cuesFor(route: TrailRoute): TrailRouteMapCues {
        val shape = TrailRouteTraversalShapeSijko.shapeFor(route)
        return TrailRouteMapCues(
            pieces = shape.pieces.map { piece ->
                TrailRouteMapCuePiece(
                    segment = if (piece.repeatsEarlierTravel) {
                        piece.segment.copy(points = offsetToTheRight(piece.segment.points, SecondPassOffsetMeters))
                    } else {
                        piece.segment
                    },
                    repeatsEarlierTravel = piece.repeatsEarlierTravel,
                    distancesAlongRouteMeters = piece.distancesAlongRouteMeters,
                )
            },
            turnarounds = shape.reversals,
        )
    }

    /** Shifts a polyline sideways by [meters], to the right of its direction of travel. */
    fun offsetToTheRight(points: List<MapPoint>, meters: Double): List<MapPoint> {
        if (points.size < 2) {
            return points
        }
        val metersPerDegreeLatitude = MetersPerDegree
        return points.mapIndexed { index, point ->
            val before = points[maxOf(index - 1, 0)]
            val after = points[minOf(index + 1, points.lastIndex)]
            val metersPerDegreeLongitude = MetersPerDegree * cos(point.latitude * PI / 180.0)
            val east = (after.longitude - before.longitude) * metersPerDegreeLongitude
            val north = (after.latitude - before.latitude) * metersPerDegreeLatitude
            val length = sqrt(east * east + north * north)
            if (length == 0.0) {
                point
            } else {
                // The right-hand normal of travel direction (east, north) is (north, -east).
                MapPoint(
                    latitude = point.latitude + (-east / length) * meters / metersPerDegreeLatitude,
                    longitude = point.longitude + (north / length) * meters / metersPerDegreeLongitude,
                )
            }
        }
    }

    private const val SecondPassOffsetMeters = 8.0
    private const val MetersPerDegree = 111_320.0
}
