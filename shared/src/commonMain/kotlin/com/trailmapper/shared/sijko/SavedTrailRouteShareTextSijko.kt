/**
 * Job: Build the portable text accompanying a shared Trail Mapper route image or fallback share.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.routing.TrailRouteAdvisorySijko
import com.trailmapper.shared.routing.TrailRouteInstructionDistanceSijko
import com.trailmapper.shared.routing.TrailRouteTraversalShapeSijko
import kotlin.time.Clock

object SavedTrailRouteShareTextSijko {
    fun textFor(
        savedRoute: SavedTrailRoute,
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
    ): String {
        return buildString {
            appendLine(savedRoute.title)
            appendLine(savedRoute.summary)
            turnaroundLine(savedRoute)?.let(::appendLine)
            appendLine()
            TrailRouteAdvisorySijko.forRoute(savedRoute.route, nowEpochMillis).forEach { advisory ->
                appendLine(advisory.title)
                appendLine(advisory.message)
                appendLine(advisory.sourceUrl)
                appendLine()
            }
            append("Shared from Trail Mapper.")
        }
    }

    /** For example "2 turnarounds: turn back at 1.2 mi and 3.4 mi." Null when the route never turns back. */
    private fun turnaroundLine(savedRoute: SavedTrailRoute): String? {
        val distances = TrailRouteTraversalShapeSijko.shapeFor(savedRoute.route).reversals
            .map { reversal -> TrailRouteInstructionDistanceSijko.labelFor(reversal.distanceAlongRouteMeters) }
        if (distances.isEmpty()) {
            return null
        }
        val count = if (distances.size == 1) "1 turnaround" else "${distances.size} turnarounds"
        val places = if (distances.size == 1) {
            distances.single()
        } else {
            distances.dropLast(1).joinToString(", ") + " and " + distances.last()
        }
        return "$count: turn back at $places."
    }
}
