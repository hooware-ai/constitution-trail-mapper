/**
 * Job: Decide whether two routes are the same ride, so saved and recent lists hold each route once.
 *
 */
package com.trailmapper.shared.routing

object TrailRouteIdentitySijko {
    /** The same route geometry and graph path, ridden either way round. */
    fun isSameRoute(
        first: TrailRoute,
        second: TrailRoute,
    ): Boolean {
        return first == second || first == TrailRouteReverseSijko.reversed(second)
    }
}
