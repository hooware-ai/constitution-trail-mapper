/**
 * Job: Carry a distance-targeted exercise route with its selection diagnostics.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
data class ExerciseRouteResult(
    val route: TrailRoute,
    val status: ExerciseRouteStatus,
    val summary: String,
    val routeKey: String,
    val durationSummary: String,
    val distanceErrorMeters: Double,
    val historyOverlapMeters: Double,
    val selfOverlapMeters: Double,
)
