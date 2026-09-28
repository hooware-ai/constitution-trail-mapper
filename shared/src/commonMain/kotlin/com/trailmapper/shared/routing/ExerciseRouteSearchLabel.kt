/**
 * Job: Carry one cost/distance alternative for reaching a node in a bounded exercise search.
 *
 */
package com.trailmapper.shared.routing

internal data class ExerciseRouteSearchLabel(
    val nodeId: Int,
    val totalCost: Double,
    val physicalDistanceMeters: Double,
    /** The label this one extends; null only for the start label. */
    val previousLabelId: Int?,
    val edge: TrailGraphEdge?,
)
