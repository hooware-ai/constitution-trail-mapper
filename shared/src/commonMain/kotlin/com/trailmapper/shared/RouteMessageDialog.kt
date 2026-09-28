/**
 * Job: Carry one route-planner dialog title and message.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute

data class RouteMessageDialog(
    val title: String,
    val message: String,
    val route: TrailRoute? = null,
)
