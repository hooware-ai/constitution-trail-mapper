/**
 * Job: Carry a queued graph node and current route cost for priority search.
 *
 */
package com.trailmapper.shared.routing

internal data class TrailRouteQueueEntry(
    val nodeId: Int,
    val cost: Double,
    /** The search label this entry expands, for searches that keep several labels per node. */
    val labelId: Int = 0,
)
