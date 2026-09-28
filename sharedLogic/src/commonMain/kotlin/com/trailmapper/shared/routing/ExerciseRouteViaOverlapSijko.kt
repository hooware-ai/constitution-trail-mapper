/**
 * Job: Estimate, from the search trees alone, how much a root → anchor → via → root loop retraces itself.
 *
 */
package com.trailmapper.shared.routing

/**
 * A via loop rides the outbound tree to the anchor, the anchor's tree to the via, then the outbound tree
 * backward from the via to the root. Two retraces follow from the trees' shapes:
 * - the return leaves the root along the same stem as the outbound path, up to where the via's and the
 *   anchor's outbound branches part; and
 * - the anchor → via and root → via branches can reach the via along the same final edges, a spur ridden
 *   out and back.
 * Estimating these lets the via choice weigh retracing as the candidate score does, rather than picking
 * among near-equal distances by meters of noise.
 */
internal class ExerciseRouteViaOverlapSijko(
    private val rootSearch: ExerciseRouteSearchTree,
    private val fromAnchorSearch: ExerciseRouteSearchTree,
    anchorNodeId: Int,
) {
    private val anchorBranchDistances: Map<Int, Double> = buildMap {
        var labelId = rootSearch.bestLabelIds[anchorNodeId]
        while (labelId != null) {
            val label = rootSearch.labels[labelId]
            put(labelId, label.physicalDistanceMeters)
            labelId = label.previousLabelId
        }
    }
    private val sharedStemMeters = DoubleArray(rootSearch.labels.size) { Double.NaN }

    fun retracedMeters(viaNodeId: Int): Double {
        val rootLabelId = rootSearch.bestLabelIds[viaNodeId] ?: return 0.0
        return sharedStem(rootLabelId) + sharedSpurMeters(rootLabelId, fromAnchorSearch.bestLabelIds[viaNodeId])
    }

    /** Distance from the root to where [labelId]'s outbound branch leaves the anchor's. */
    private fun sharedStem(labelId: Int): Double {
        val pending = mutableListOf<Int>()
        var cursor: Int? = labelId
        var stem = 0.0
        while (cursor != null) {
            val known = sharedStemMeters[cursor]
            if (!known.isNaN()) {
                stem = known
                break
            }
            val onAnchorBranch = anchorBranchDistances[cursor]
            if (onAnchorBranch != null) {
                stem = onAnchorBranch
                break
            }
            pending += cursor
            cursor = rootSearch.labels[cursor].previousLabelId
        }
        pending.forEach { sharedStemMeters[it] = stem }
        return stem
    }

    private fun sharedSpurMeters(rootLabelId: Int, anchorLabelId: Int?): Double {
        var fromRoot = rootSearch.labels[rootLabelId]
        var fromAnchor = anchorLabelId?.let(fromAnchorSearch.labels::get) ?: return 0.0
        var spur = 0.0
        while (true) {
            val rootEdge = fromRoot.edge ?: break
            val anchorEdge = fromAnchor.edge ?: break
            if (rootEdge.id != anchorEdge.id || rootEdge.fromNodeId != anchorEdge.fromNodeId) {
                break
            }
            spur += rootEdge.distanceMeters
            fromRoot = fromRoot.previousLabelId?.let(rootSearch.labels::get) ?: break
            fromAnchor = fromAnchor.previousLabelId?.let(fromAnchorSearch.labels::get) ?: break
        }
        return spur
    }
}
