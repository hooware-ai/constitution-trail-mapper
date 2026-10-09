/**
 * Job: Format constrained route results into concise route-planner feedback.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.abs
import kotlin.math.max

object TrailRouteSummarySijko {
    fun summaryFor(route: TrailRoute): String {
        if (route.kind == TrailRouteKind.ExerciseLoop) {
            val targetDistanceMeters = route.requestedDistanceMeters ?: route.totalDistanceMeters
            val status = if (
                abs(route.totalDistanceMeters - targetDistanceMeters) <=
                ExerciseRouteTargetSijko.toleranceMeters(targetDistanceMeters)
            ) {
                ExerciseRouteStatus.Exact
            } else {
                ExerciseRouteStatus.Closest
            }
            return ExerciseRouteSummarySijko.summaryFor(
                route = route,
                status = status,
                durationSummary = ExerciseRouteDurationSijko.formatFor(route.totalDistanceMeters),
            )
        }
        val totalMiles = route.totalDistanceMeters.toMiles()
        val accessMiles = route.ordinaryAccessDistanceMeters.toMiles()
        val sharedRoadMiles = route.sharedRoadwayDistanceMeters.toMiles()
        val trailMiles = max(
            0.0,
            route.totalDistanceMeters - route.ordinaryAccessDistanceMeters - route.sharedRoadwayDistanceMeters,
        ).toMiles()
        val sharedRoadText = if (route.sharedRoadwayDistanceMeters > MINIMUM_SHARED_ROADWAY_REPORT_METERS) {
            ", ${sharedRoadMiles.formatMiles()} shared-road miles"
        } else {
            ""
        }
        return "Trail route found: ${trailMiles.formatMiles()} trail/connector miles$sharedRoadText, " +
            "${accessMiles.formatMiles()} access miles, ${totalMiles.formatMiles()} total miles."
    }

    private fun Double.toMiles(): Double = this / 1609.344

    private fun Double.formatMiles(): String {
        return if (this < 0.05) {
            "0.00"
        } else {
            formatRouteMiles(this)
        }
    }

    private const val MINIMUM_SHARED_ROADWAY_REPORT_METERS = 0.01
}
