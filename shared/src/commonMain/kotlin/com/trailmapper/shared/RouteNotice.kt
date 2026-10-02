/**
 * Job: Carry one route-planner dialog title and message.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute

data class RouteNotice(
    val title: String,
    val message: String,
    val route: TrailRoute? = null,
    /** False when asking again would give the same answer, so the rider should change something instead. */
    val retryable: Boolean = true,
)
