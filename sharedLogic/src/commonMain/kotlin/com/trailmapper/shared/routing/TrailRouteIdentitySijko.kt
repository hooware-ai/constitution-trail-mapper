/**
 * Job: Decide whether two routes are the same ride, so saved and recent lists hold each route once.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object TrailRouteIdentitySijko {
    /**
     * The same kind of route along the same drawn path, ridden either way round. Cost, layers and other
     * scoring metadata do not count: a route re-scored or re-planned with other settings is still that ride.
     */
    fun isSameRoute(
        first: TrailRoute,
        second: TrailRoute,
    ): Boolean {
        if (first.kind != second.kind) return false
        val firstPath = pathOf(first)
        val secondPath = pathOf(second)
        if (firstPath.isEmpty() || secondPath.isEmpty()) {
            // Nothing drawn to compare; only an identical record, either way round, is the same.
            return first == second || first == TrailRouteReverseSijko.reversed(second)
        }
        return firstPath == secondPath || firstPath == secondPath.asReversed()
    }

    /** The drawn path as one point sequence, without the repeated point where segments join. */
    private fun pathOf(route: TrailRoute): List<MapPoint> {
        val path = mutableListOf<MapPoint>()
        route.segments.forEach { segment ->
            segment.points.forEach { point ->
                if (path.lastOrNull() != point) path += point
            }
        }
        return path
    }
}
