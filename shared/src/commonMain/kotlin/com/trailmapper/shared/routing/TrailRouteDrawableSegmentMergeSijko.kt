/**
 * Job: Coalesce adjacent same-style route segments before map rendering.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object TrailRouteDrawableSegmentMergeSijko {
    fun merge(
        segments: List<TrailRouteSegment>,
        maxJoinGapMeters: Double = DEFAULT_MAX_JOIN_GAP_METERS,
    ): List<TrailRouteSegment> = mergeTracked(segments, maxJoinGapMeters).merged

    /**
     * For each index into [segments] whose first point the drawn route reaches by bridging a gap from the
     * previous segment, the length of that bridge. Decided at that boundary by the same rule as [merge],
     * so the same two points joined elsewhere on the route say nothing about this boundary.
     */
    fun bridgedGaps(
        segments: List<TrailRouteSegment>,
        maxJoinGapMeters: Double = DEFAULT_MAX_JOIN_GAP_METERS,
    ): Map<Int, Double> = mergeTracked(segments, maxJoinGapMeters).bridgedGaps

    private fun mergeTracked(segments: List<TrailRouteSegment>, maxJoinGapMeters: Double): Tracked {
        val pieces = segments.flatMapIndexed { index, segment ->
            // A U-turn stays a boundary between drawn pieces, so a reversal is never hidden inside one line.
            TrailRouteTraversalShapeSijko.splitAtReversals(segment.points.withoutConsecutiveDuplicates())
                .map { points -> index to segment.copy(points = points, name = TrailRouteNameSijko.normalized(segment.name)) }
                .filter { (_, piece) -> piece.points.size >= MINIMUM_SEGMENT_POINT_COUNT }
        }
        val merged = mutableListOf<TrailRouteSegment>()
        val bridgedGaps = mutableMapOf<Int, Double>()
        var previousIndex: Int? = null
        pieces.forEach { (index, segment) ->
            val previous = merged.lastOrNull()
            if (previous == null ||
                previous.type != segment.type ||
                previous.isRouted != segment.isRouted ||
                previous.routeRoles != segment.routeRoles ||
                previous.displayStyle != segment.displayStyle ||
                !TrailRouteNameSijko.matches(previous.name, segment.name) ||
                !previous.endsCloseTo(segment, maxJoinGapMeters) ||
                previous.turnsBackInto(segment)
            ) {
                merged += segment
            } else {
                val gap = TrailDistanceSijko.metersBetween(previous.points.last(), segment.points.first())
                if (index != previousIndex && gap > 0.0) {
                    bridgedGaps[index] = gap
                }
                merged[merged.lastIndex] = previous.copy(
                    points = previous.points + segment.points.pointsAfterJoin(previous.points.last()),
                )
            }
            previousIndex = index
        }
        return Tracked(merged, bridgedGaps)
    }

    private class Tracked(val merged: List<TrailRouteSegment>, val bridgedGaps: Map<Int, Double>)

    private fun TrailRouteSegment.endsCloseTo(
        next: TrailRouteSegment,
        maxJoinGapMeters: Double,
    ): Boolean {
        return TrailDistanceSijko.metersBetween(points.last(), next.points.first()) <= maxJoinGapMeters
    }

    private fun TrailRouteSegment.turnsBackInto(next: TrailRouteSegment): Boolean {
        return points.last() == next.points.first() &&
            points.size >= 2 && next.points.size >= 2 &&
            points[points.size - 2] == next.points[1]
    }

    private fun List<MapPoint>.pointsAfterJoin(joinPoint: MapPoint): List<MapPoint> {
        return if (first() == joinPoint) {
            drop(1)
        } else {
            this
        }
    }

    private fun <T> List<T>.withoutConsecutiveDuplicates(): List<T> {
        return fold(emptyList<T>()) { result, item ->
            if (result.lastOrNull() == item) {
                result
            } else {
                result + item
            }
        }
    }

    private const val DEFAULT_MAX_JOIN_GAP_METERS = 35.0
    private const val MINIMUM_SEGMENT_POINT_COUNT = 2
}
