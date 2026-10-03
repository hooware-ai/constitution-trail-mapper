/**
 * Job: Find where the route graph's derived geometry stands for the source leg a closure sits on, with the closure's
 * interval or crossing position transferred onto it exactly.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

/**
 * A leg of the graph's geometry that stands for a leg of a closure's source line, from [from] to [to], with the closure's
 * interval transferred onto it: [low] to [high] meters from [from] along it (a crossing's position is the one value twice).
 */
data class TrailRouteDerivedClosureLeg(
    val closureId: String,
    val from: MapPoint,
    val to: MapPoint,
    val low: Double,
    val high: Double,
)

/**
 * The graph puts every vertex within its snap tolerance on one node, and a route that is snapped, or that follows a
 * junction connector, is drawn on geometry anchored on those node points: a source leg whose end vertex was moved onto a
 * neighboring feature's node becomes a leg a few meters off the source line. Nothing about the closure moves with it, so
 * the closure's interval must be carried across by the correspondence the graph itself defines: the raw leg and the
 * derived leg that replaces it are the same leg of the same polyline (the same index), with only the moved end vertices
 * replaced by their anchors, and a position by its fraction along the raw leg is the same fraction along the derived one.
 * This is computed from the CURRENT graph, never read from a saved route.
 */
object TrailRouteClosureDerivationSijko {
    // The closure's bounds (or crossing) must lie ON the raw leg for it to be the leg the closure sits on.
    private const val BoundOnLegMeters = 0.5
    private const val CrossingOnLegMeters = 3.0

    // A leg is derived only if an end vertex really moved.
    private const val MovedMeters = 0.01

    fun legsFor(
        graph: TrailGraph,
        closures: List<TrailRouteClosure> = TrailRouteClosureSijko.closures,
    ): List<TrailRouteDerivedClosureLeg> {
        val relevant = closures.filter { it.boundsProjected || it.isCrossing }
        if (relevant.isEmpty()) {
            return emptyList()
        }
        val featureIds = relevant.mapTo(mutableSetOf()) { it.featureId }
        val nodes = graph.nodes.associateBy { it.id }
        val edgesById = graph.edges.associateBy { it.id }
        val legs = mutableListOf<TrailRouteDerivedClosureLeg>()
        graph.edges.forEach { edge ->
            val featureId = edge.sourceFeatureId ?: return@forEach
            if (featureId !in featureIds) {
                return@forEach
            }
            val geometry = edge.routeSegments.flatMap { it.points }
            val pair = (if (edge.connectorOfEdgeId == null) original(geometry, edge, nodes) else connector(geometry, edge, edgesById))
                ?: return@forEach
            val (source, derived) = pair
            source.zipWithNext().forEachIndexed { index, (sourceFrom, sourceTo) ->
                val derivedFrom = derived[index]
                val derivedTo = derived[index + 1]
                if (TrailDistanceSijko.metersBetween(sourceFrom, derivedFrom) <= MovedMeters &&
                    TrailDistanceSijko.metersBetween(sourceTo, derivedTo) <= MovedMeters
                ) {
                    return@forEachIndexed
                }
                val frame = TrailRouteSourceFrame(sourceFrom, sourceTo).takeIf { it.length > 0.0 } ?: return@forEachIndexed
                val derivedLength = TrailDistanceSijko.metersBetween(derivedFrom, derivedTo)
                relevant.filter { it.featureId == featureId }.forEach { closure ->
                    val fractions = fractionsOn(frame, closure) ?: return@forEach
                    legs += TrailRouteDerivedClosureLeg(
                        closureId = closure.id,
                        from = derivedFrom,
                        to = derivedTo,
                        low = fractions.first * derivedLength,
                        high = fractions.second * derivedLength,
                    )
                }
            }
        }
        return legs
    }

    /** A run of the source feature and the same run with its two ends anchored on the graph's nodes. */
    private fun original(geometry: List<MapPoint>, edge: TrailGraphEdge, nodes: Map<Int, TrailGraphNode>): Pair<List<MapPoint>, List<MapPoint>>? {
        if (geometry.size < 2) {
            return null
        }
        val from = nodes[edge.fromNodeId] ?: return null
        val to = nodes[edge.toNodeId] ?: return null
        return Pair(geometry, listOf(from.point) + geometry.drop(1).dropLast(1) + to.point)
    }

    /**
     * A junction connector: node point, projection onto the run, the run's vertices, then the run's end node. The raw
     * counterpart has the run's own end vertex where the connector ends on the node.
     */
    private fun connector(geometry: List<MapPoint>, edge: TrailGraphEdge, edgesById: Map<Int, TrailGraphEdge>): Pair<List<MapPoint>, List<MapPoint>>? {
        if (geometry.size < 2) {
            return null
        }
        val parent = edgesById[edge.connectorOfEdgeId] ?: return null
        val parentRun = parent.routeSegments.flatMap { it.points }
        val rawEnd = (if (edge.toNodeId == parent.fromNodeId) parentRun.firstOrNull() else parentRun.lastOrNull()) ?: return null
        return Pair(geometry.dropLast(1) + rawEnd, geometry)
    }

    /**
     * The part of the closure that lies along this raw leg, as fractions of the leg (lowest first), or null when none of it
     * does. The raw leg may be only part of the closure's source leg (a junction connector starts at a projection point
     * partway along it), so the interval is intersected with the leg rather than required to lie inside it: a bound that is
     * behind the leg's start or beyond its end clamps to that end, because from there the leg is inside the closure. The
     * closure's bounds lie on one source line, so a leg that is not on that line has no part of it.
     */
    private fun fractionsOn(frame: TrailRouteSourceFrame, closure: TrailRouteClosure): Pair<Double, Double>? {
        val tolerance = if (closure.isCrossing) CrossingOnLegMeters else BoundOnLegMeters
        val points = if (closure.isCrossing) listOf(closure.closedFrom) else listOf(closure.closedFrom, closure.closedTo)
        if (points.any { frame.across(it) > tolerance }) {
            return null
        }
        val positions = points.map { frame.along(it) }
        val low = positions.min()
        val high = positions.max()
        if (closure.isCrossing) {
            if (low < -tolerance || low > frame.length + tolerance) {
                return null
            }
        } else if (high <= 0.0 || low >= frame.length) {
            // Touching at a point, or wholly behind or beyond this leg: none of the interval is on it.
            return null
        }
        val fractions = positions.map { (it / frame.length).coerceIn(0.0, 1.0) }
        return Pair(fractions.min(), fractions.max())
    }
}
