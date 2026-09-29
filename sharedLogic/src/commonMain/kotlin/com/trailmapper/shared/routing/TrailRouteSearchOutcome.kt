/**
 * Job: Carry a trail-route search result and any active closures that prevented a route.
 *
 */
package com.trailmapper.shared.routing

data class TrailRouteSearchOutcome(
    val route: TrailRoute?,
    /** Non-empty only when no route was found and one exists through these closed sections. */
    val blockingClosures: List<TrailRouteClosure>,
)
