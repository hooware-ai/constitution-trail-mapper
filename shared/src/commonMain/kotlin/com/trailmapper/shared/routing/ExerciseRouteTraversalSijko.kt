/**
 * Job: Convert graph traversals into stable direction-independent exercise-history records.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.roundToLong

object ExerciseRouteTraversalSijko {
    fun traversalFor(edges: List<TrailGraphEdge>): List<TrailRouteTraversalEdge> {
        return edges.map { edge ->
            TrailRouteTraversalEdge(
                key = keyFor(edge),
                distanceMeters = edge.distanceMeters,
                ordinaryAccessDistanceMeters = edge.ordinaryAccessDistanceMeters,
                geometryMeters = edge.routeSegments.sumOf { segment -> TrailDistanceSijko.pathLengthMeters(segment.points) },
            )
        }
    }

    /**
     * The part of [traversal] between [fromMeters] and [toMeters] along it, in order. An edge cut by
     * either bound keeps its key with its distances prorated to the part inside.
     */
    fun slice(
        traversal: List<TrailRouteTraversalEdge>,
        fromMeters: Double,
        toMeters: Double = Double.POSITIVE_INFINITY,
    ): List<TrailRouteTraversalEdge> {
        var startMeters = 0.0
        return traversal.mapNotNull { edge ->
            val edgeStart = startMeters
            val edgeEnd = startMeters + edge.distanceMeters
            startMeters = edgeEnd
            val inside = minOf(edgeEnd, toMeters) - maxOf(edgeStart, fromMeters)
            when {
                inside <= SLICE_TOLERANCE_METERS -> null
                // Edges wholly inside are kept exactly; the sums above carry floating-point error.
                inside >= edge.distanceMeters - SLICE_TOLERANCE_METERS -> edge
                else -> {
                    val share = inside / edge.distanceMeters
                    edge.copy(
                        distanceMeters = inside,
                        ordinaryAccessDistanceMeters = edge.ordinaryAccessDistanceMeters * share,
                        geometryMeters = edge.geometryMeters?.let { it * share },
                    )
                }
            }
        }
    }

    fun keyFor(edge: TrailGraphEdge): String {
        val source = edge.sourceFeatureId?.trim()?.takeIf { it.isNotEmpty() } ?: "unattributed"
        val points = edge.routeSegments
            .flatMap { segment -> segment.points }
            .ifEmpty { emptyList() }
        val geometry = if (points.isEmpty()) {
            "unknown"
        } else {
            val forward = points.joinToString(separator = ";") { it.normalizedCoordinate() }
            val reverse = points.asReversed().joinToString(separator = ";") { it.normalizedCoordinate() }
            minOf(forward, reverse)
        }
        return "$source#$geometry"
    }

    internal fun coordinateOf(point: MapPoint): String = point.normalizedCoordinate()

    private fun MapPoint.normalizedCoordinate(): String {
        return "${(latitude * CoordinateScale).roundToLong()},${(longitude * CoordinateScale).roundToLong()}"
    }

    private const val CoordinateScale = 10_000_000.0
    private const val SLICE_TOLERANCE_METERS = 1e-6
}
