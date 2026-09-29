/**
 * Job: Carry what a planner form needs to come back after the app process is killed.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.ExerciseRouteResult
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpoints
import com.trailmapper.shared.sijko.RouteLayerSelection
import kotlinx.serialization.Serializable

@Serializable
data class RoutePlannerDraft(
    val savedAtEpochMillis: Long,
    val endpoints: RouteEndpoints,
    val routeLayers: RouteLayerSelection,
    /** The route found for these endpoints, so a rider who was viewing it comes back to it. */
    val lastRoute: TrailRoute? = null,
)

@Serializable
data class ExercisePlannerDraft(
    val savedAtEpochMillis: Long,
    val startAddress: String,
    val startPoint: MapPoint?,
    val targetMilesText: String,
    val proposedTrailsEnabled: Boolean,
    val result: ExerciseRouteResult? = null,
)
