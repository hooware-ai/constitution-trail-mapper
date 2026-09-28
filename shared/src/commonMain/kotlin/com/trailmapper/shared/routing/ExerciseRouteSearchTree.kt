/**
 * Job: Carry one compact shortest-path tree without materializing a path for every reachable node.
 *
 */
package com.trailmapper.shared.routing

internal data class ExerciseRouteSearchTree(
    val startNodeId: Int,
    /** Cost and distance of each node's cheapest label. */
    val totalCosts: Map<Int, Double>,
    val physicalDistancesMeters: Map<Int, Double>,
    val bestLabelIds: Map<Int, Int>,
    /** Every label created by the search, indexed by label id; each links to its own predecessor. */
    val labels: List<ExerciseRouteSearchLabel>,
)
