/**
 * Job: Format concise exercise-loop feedback for the route planner.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.round

object ExerciseRouteSummarySijko {
    fun summaryFor(
        route: TrailRoute,
        status: ExerciseRouteStatus,
        durationSummary: String,
    ): String {
        val label = if (status == ExerciseRouteStatus.Exact) "Exercise loop found" else "Closest exercise route found"
        val retracedDistanceMeters = ExerciseRouteOverlapSijko.selfOverlapMeters(route.traversalEdges)
        val retracedText = if (retracedDistanceMeters >= MinimumReportedRetracingMeters) {
            "; ${retracedDistanceMeters.toMiles().formatMiles()} mi retraced"
        } else {
            ""
        }
        return "$label: ${route.totalDistanceMeters.toMiles().formatMiles()} mi, " +
            "about $durationSummary at 8 mph$retracedText."
    }

    private fun Double.toMiles(): Double = this / MetersPerMile

    private fun Double.formatMiles(): String = (round(this * 100.0) / 100.0).toString()

    private const val MetersPerMile = 1_609.344
    private const val MinimumReportedRetracingMeters = 50.0
}
