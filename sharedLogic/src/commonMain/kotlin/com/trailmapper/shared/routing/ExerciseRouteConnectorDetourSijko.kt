/**
 * Job: Replace snap-connector detours in an exercise candidate with the trail edge they stand in for.
 *
 */
package com.trailmapper.shared.routing

/**
 * The graph builder links a node lying beside an edge by adding copies of that edge that run from the
 * node to each end, and keeps the original. A loop's return search, which penalizes reusing outbound
 * edges, can then ride X→N→Y through the copies instead of reusing X→Y. That hides the retrace behind
 * different edge keys and pokes out to N and back, a U-turn of a few meters. This collapses each such
 * pair back into the direct edge so the candidate is scored and drawn as ridden.
 *
 * Only edges derived from one original edge (the original and its connector copies) are collapsed,
 * so a real path of the same trail, however close to the direct edge, is never replaced.
 */
internal object ExerciseRouteConnectorDetourSijko {
    fun collapse(
        edges: List<TrailGraphEdge>,
        adjacency: Map<Int, List<ExerciseRouteSearchEdge>>,
    ): List<TrailGraphEdge> {
        val result = ArrayList<TrailGraphEdge>(edges.size)
        edges.forEach { edge ->
            result += edge
            while (result.size >= 2) {
                val direct = directEdgeFor(result[result.lastIndex - 1], result.last(), adjacency) ?: break
                result.removeAt(result.lastIndex)
                result[result.lastIndex] = direct
            }
        }
        return result
    }

    private fun directEdgeFor(
        first: TrailGraphEdge,
        second: TrailGraphEdge,
        adjacency: Map<Int, List<ExerciseRouteSearchEdge>>,
    ): TrailGraphEdge? {
        val family = first.family
        if (second.family != family ||
            first.connectorOfEdgeId == null && second.connectorOfEdgeId == null ||
            first.fromNodeId == second.toNodeId
        ) {
            return null
        }
        val detourMeters = first.distanceMeters + second.distanceMeters
        // The pair pokes out and back by (detour - direct) / 2. A connector reaches at most the snap
        // tolerance off the edge; a longer poke is a real out-and-back along it, and is kept.
        return adjacency[first.fromNodeId].orEmpty()
            .asSequence()
            .map { it.edge }
            .filter { candidate ->
                candidate.toNodeId == second.toNodeId &&
                    candidate.family == family &&
                    detourMeters <= candidate.distanceMeters + 2.0 * SnapToleranceMeters
            }
            .minWithOrNull(compareBy({ it.distanceMeters }, { it.id }))
    }

    private val TrailGraphEdge.family: Int get() = connectorOfEdgeId ?: id

    private const val SnapToleranceMeters = TrailGraphBuilderSijko.DEFAULT_SNAP_TOLERANCE_METERS
}
