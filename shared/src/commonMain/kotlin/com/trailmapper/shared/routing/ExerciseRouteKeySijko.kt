/**
 * Job: Produce direction-independent stable identities for completed exercise routes.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.roundToLong

object ExerciseRouteKeySijko {
    fun keyFor(traversalEdges: List<TrailRouteTraversalEdge>): String {
        return traversalEdges
            .groupBy { it.key }
            .entries
            .sortedBy { entry -> entry.key }
            .joinToString(separator = "|") { (key, edges) ->
                "$key:${(edges.sumOf { it.distanceMeters } * MillimetersPerMeter).roundToLong()}"
            }
            .let { signature -> "exercise:$signature" }
    }

    private const val MillimetersPerMeter = 1_000.0
}
