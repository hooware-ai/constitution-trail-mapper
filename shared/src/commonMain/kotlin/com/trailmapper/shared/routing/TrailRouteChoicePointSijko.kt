/**
 * Job: Record which vertices along a built route are real choice points for same-trail turn guidance.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.floor

/**
 * A choice point is a boundary between two consecutive route edges where the rider has a real decision:
 * - a trail-graph node joined to at least three distinct neighbors, or
 * - a shared-roadway vertex within [StreetIntersectionMatchMeters] of a street intersection (an
 *   access-road node with at least three distinct neighbors). Cross streets are not in the trail graph,
 *   so an on-street corner can be a real choice even at trail-graph degree two.
 * A trail bend where only two features meet, or a crossing without a route choice, is not recorded.
 */
internal object TrailRouteChoicePointSijko {
    fun annotate(
        edges: List<TrailGraphEdge>,
        traversal: List<TrailRouteTraversalEdge>,
        trailGraph: TrailGraph,
        accessGraph: TrailGraph?,
    ): List<TrailRouteTraversalEdge> {
        if (edges.size != traversal.size || edges.size < 2) {
            return traversal
        }
        val trailJunctions = junctionPoints(trailGraph).toHashSet()
        val streetIntersections = accessGraph?.let { grid(junctionPoints(it)) }.orEmpty()
        return traversal.mapIndexed { index, traversalEdge ->
            val next = edges.getOrNull(index + 1) ?: return@mapIndexed traversalEdge
            val edge = edges[index]
            val boundary = edge.routeSegments.lastOrNull()?.points?.lastOrNull() ?: return@mapIndexed traversalEdge
            val onSharedRoadway = TrailNetworkRole.SharedRoadways in edge.routeRoles ||
                TrailNetworkRole.SharedRoadways in next.routeRoles
            val isChoicePoint = boundary in trailJunctions ||
                (onSharedRoadway && nearAny(boundary, streetIntersections))
            if (isChoicePoint) {
                traversalEdge.copy(
                    junctionCoordinates = traversalEdge.junctionCoordinates + ExerciseRouteTraversalSijko.coordinateOf(boundary),
                )
            } else {
                traversalEdge
            }
        }
    }

    private fun junctionPoints(graph: TrailGraph): List<MapPoint> {
        val neighbors = mutableMapOf<Int, MutableSet<Int>>()
        graph.edges.forEach { edge ->
            if (edge.fromNodeId != edge.toNodeId) {
                neighbors.getOrPut(edge.fromNodeId) { mutableSetOf() } += edge.toNodeId
                neighbors.getOrPut(edge.toNodeId) { mutableSetOf() } += edge.fromNodeId
            }
        }
        return graph.nodes.filter { node -> (neighbors[node.id]?.size ?: 0) >= 3 }.map { it.point }
    }

    private fun grid(points: List<MapPoint>): Map<Long, List<MapPoint>> = points.groupBy { cellOf(it.latitude, it.longitude) }

    private fun nearAny(point: MapPoint, grid: Map<Long, List<MapPoint>>): Boolean {
        val cellLatitude = floor(point.latitude / CellDegrees).toLong()
        val cellLongitude = floor(point.longitude / CellDegrees).toLong()
        for (dLat in -1L..1L) {
            for (dLon in -1L..1L) {
                val candidates = grid[key(cellLatitude + dLat, cellLongitude + dLon)] ?: continue
                if (candidates.any { TrailDistanceSijko.metersBetween(it, point) <= StreetIntersectionMatchMeters }) {
                    return true
                }
            }
        }
        return false
    }

    private fun cellOf(latitude: Double, longitude: Double): Long =
        key(floor(latitude / CellDegrees).toLong(), floor(longitude / CellDegrees).toLong())

    private fun key(cellLatitude: Long, cellLongitude: Long): Long = (cellLatitude shl 32) xor (cellLongitude and 0xFFFFFFFFL)

    private const val StreetIntersectionMatchMeters = 15.0
    // About 55 m of latitude; a 15 m match never needs more than the neighboring cells.
    private const val CellDegrees = 0.0005
}
