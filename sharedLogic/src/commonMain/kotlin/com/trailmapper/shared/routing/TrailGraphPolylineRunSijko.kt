/**
 * Job: Split one polyline into node-to-node runs so vertices that snap onto the same graph node
 * extend a single edge instead of becoming zero-length self-loops.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailGraphPolylineRun(
    val fromNodeId: Int,
    val toNodeId: Int,
    val points: List<MapPoint>,
    val distanceMeters: Double,
)

object TrailGraphPolylineRunSijko {
    fun runs(
        path: List<MapPoint>,
        nodeIdFor: (MapPoint) -> Int,
        cancellationCheckpoint: () -> Unit = {},
    ): List<TrailGraphPolylineRun> {
        val runs = mutableListOf<TrailGraphPolylineRun>()
        var anchorNodeId: Int? = null
        var runPoints = mutableListOf<MapPoint>()
        var runDistanceMeters = 0.0

        path.forEachIndexed { index, point ->
            if (index == 0) {
                runPoints += point
                return@forEachIndexed
            }
            cancellationCheckpoint()
            val stepMeters = TrailDistanceSijko.metersBetween(runPoints.last(), point)
            if (stepMeters <= DUPLICATE_VERTEX_METERS) {
                return@forEachIndexed
            }

            // Resolve the first node lazily so a path of duplicate vertices creates no node.
            val fromNodeId = anchorNodeId ?: nodeIdFor(runPoints.first())
            anchorNodeId = fromNodeId
            runPoints += point
            runDistanceMeters += stepMeters

            val nodeId = nodeIdFor(point)
            if (nodeId != fromNodeId) {
                runs += TrailGraphPolylineRun(
                    fromNodeId = fromNodeId,
                    toNodeId = nodeId,
                    points = runPoints,
                    distanceMeters = runDistanceMeters,
                )
                anchorNodeId = nodeId
                runPoints = mutableListOf(point)
                runDistanceMeters = 0.0
            }
        }

        // Any remaining run ends back on its anchor node: a spur shorter than the snap
        // tolerance with no node of its own, so it is not routable.
        return runs
    }

    private const val DUPLICATE_VERTEX_METERS = 0.01
}
