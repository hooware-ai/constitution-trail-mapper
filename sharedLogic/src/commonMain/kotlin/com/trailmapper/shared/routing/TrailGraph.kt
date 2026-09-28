/**
 * Job: Carry the graph nodes and edges built from approved trail-map polylines.
 *
 */
package com.trailmapper.shared.routing

data class TrailGraph(
    val nodes: List<TrailGraphNode>,
    val edges: List<TrailGraphEdge>,
)
