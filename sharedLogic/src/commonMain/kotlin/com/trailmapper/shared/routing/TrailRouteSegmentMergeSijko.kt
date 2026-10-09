/**
 * Job: Normalize drawable route segments for cleaner map rendering.
 *
 */
package com.trailmapper.shared.routing

object TrailRouteSegmentMergeSijko {
    fun merge(segments: List<TrailRouteSegment>): List<TrailRouteSegment> {
        return segments
            .mapNotNull { segment ->
                segment.copy(
                    points = segment.points.withoutConsecutiveDuplicates(),
                    name = TrailRouteNameSijko.normalized(segment.name),
                )
                    .takeIf { it.points.size >= MINIMUM_SEGMENT_POINT_COUNT }
            }
            .fold(emptyList<TrailRouteSegment>()) { merged, segment ->
                val previous = merged.lastOrNull()
                if (
                    previous == null ||
                    previous.type != segment.type ||
                    previous.isRouted != segment.isRouted ||
                    previous.routeRoles != segment.routeRoles ||
                    previous.displayStyle != segment.displayStyle ||
                    !TrailRouteNameSijko.matches(previous.name, segment.name) ||
                    previous.points.last() != segment.points.first()
                ) {
                    merged + segment
                } else {
                    merged.dropLast(1) + previous.copy(
                        points = previous.points + segment.points.drop(1),
                    )
                }
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

    private const val MINIMUM_SEGMENT_POINT_COUNT = 2
}
