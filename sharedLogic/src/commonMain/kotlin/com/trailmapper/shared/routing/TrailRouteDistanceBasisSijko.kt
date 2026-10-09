/**
 * Job: Convert between navigation distance along a route, its geometry, and its graph traversal.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

/**
 * A route is measured three ways. Navigation measures along the drawn route, which bridges small gaps
 * between same-styled segments (TrailRouteDrawableSegmentMergeSijko). The route's segments measure the
 * graph geometry without those bridges. Traversal edges carry graph distances, which for snap connectors
 * differ from their geometry. Progress on one basis must be converted before it is used to cut another,
 * or a cut lands on the wrong edge.
 */
object TrailRouteDistanceBasisSijko {
    /** The distance along [route]'s traversal edges at [navigationMeters] of navigation. */
    fun traversalMetersAt(route: TrailRoute, navigationMeters: Double): Double =
        traversalMetersAtGeometry(route.traversalEdges, geometryMetersAt(route, navigationMeters))

    /** The distance along [route]'s segments at [navigationMeters] of navigation. */
    fun geometryMetersAt(route: TrailRoute, navigationMeters: Double): Double {
        var navigation = 0.0
        var geometry = 0.0
        stretches(route).forEach { stretch ->
            if (navigationMeters <= navigation + stretch.joinMeters) {
                // Inside a bridged gap: no geometry is covered until the next segment starts.
                return geometry
            }
            navigation += stretch.joinMeters
            if (navigationMeters <= navigation + stretch.lengthMeters) {
                return geometry + (navigationMeters - navigation)
            }
            navigation += stretch.lengthMeters
            geometry += stretch.lengthMeters
        }
        return geometry
    }

    /**
     * The distance along [traversal] at [geometryMeters] along its geometry, prorated within the edge it
     * falls in. Edges without a recorded geometry length are measured by their distance, and a route with
     * no traversal at all (saved before traversals were kept) is measured by its geometry.
     */
    fun traversalMetersAtGeometry(traversal: List<TrailRouteTraversalEdge>, geometryMeters: Double): Double {
        if (traversal.isEmpty()) {
            return geometryMeters
        }
        var geometry = 0.0
        var distance = 0.0
        traversal.forEach { edge ->
            val edgeGeometry = edge.geometryMeters ?: edge.distanceMeters
            if (geometryMeters < geometry + edgeGeometry) {
                val share = if (edgeGeometry > 0.0) (geometryMeters - geometry) / edgeGeometry else 0.0
                return distance + edge.distanceMeters * share.coerceIn(0.0, 1.0)
            }
            geometry += edgeGeometry
            distance += edge.distanceMeters
        }
        return distance
    }

    /** [route]'s segments from [geometryMeters] along them to the end, cut inside the segment it falls in. */
    fun segmentsFrom(route: TrailRoute, geometryMeters: Double): List<TrailRouteSegment> {
        var start = 0.0
        return route.segments.mapNotNull { segment ->
            val length = TrailDistanceSijko.pathLengthMeters(segment.points)
            val segmentStart = start
            start += length
            when {
                segmentStart + length <= geometryMeters -> null
                segmentStart >= geometryMeters -> segment
                else -> segment.copy(points = pointsFrom(segment.points, geometryMeters - segmentStart))
            }
        }
    }

    private fun pointsFrom(points: List<MapPoint>, fromMeters: Double): List<MapPoint> {
        var travelled = 0.0
        points.zipWithNext().forEachIndexed { index, (from, to) ->
            val leg = TrailDistanceSijko.metersBetween(from, to)
            if (travelled + leg > fromMeters) {
                val ratio = if (leg > 0.0) (fromMeters - travelled) / leg else 0.0
                val cut = MapPoint(
                    latitude = from.latitude + (to.latitude - from.latitude) * ratio,
                    longitude = from.longitude + (to.longitude - from.longitude) * ratio,
                )
                return listOf(cut) + points.drop(index + 1)
            }
            travelled += leg
        }
        return points.takeLast(1)
    }

    /**
     * Each segment's geometry length, and the bridged gap before it that navigation also counts, as the
     * drawable merge decided at that boundary.
     */
    private fun stretches(route: TrailRoute): List<Stretch> {
        val bridgedGaps = TrailRouteDrawableSegmentMergeSijko.bridgedGaps(route.segments)
        return route.segments.mapIndexed { index, segment ->
            Stretch(
                joinMeters = bridgedGaps[index] ?: 0.0,
                lengthMeters = TrailDistanceSijko.pathLengthMeters(segment.points),
            )
        }
    }

    private data class Stretch(val joinMeters: Double, val lengthMeters: Double)
}
