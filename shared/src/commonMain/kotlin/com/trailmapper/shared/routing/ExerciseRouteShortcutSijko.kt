/**
 * Job: Tune an oversized exercise circuit with one bounded ordinary-road chord instead of retracing it.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.abs
import kotlin.math.ceil

object ExerciseRouteShortcutSijko {
    fun candidates(
        routeEdges: List<TrailGraphEdge>,
        accessGraph: TrailGraph,
        targetDistanceMeters: Double,
        cancellationCheckpoint: () -> Unit = {},
    ): List<List<TrailGraphEdge>> {
        val routeDistanceMeters = routeEdges.sumOf { edge -> edge.distanceMeters }
        val excessDistanceMeters = routeDistanceMeters - targetDistanceMeters
        if (routeEdges.size < 3 || accessGraph.edges.isEmpty() || excessDistanceMeters <= 0.0) {
            return emptyList()
        }

        val boundaries = sampledBoundaries(routeEdges, routeDistanceMeters)
        val candidates = mutableListOf<List<TrailGraphEdge>>()
        boundaries.dropLast(1).forEach { startBoundary ->
            cancellationCheckpoint()
            val possibleDestinations = boundaries
                .asSequence()
                .filter { destinationBoundary -> destinationBoundary.edgeIndex > startBoundary.edgeIndex + 1 }
                .map { destinationBoundary ->
                    val removedDistanceMeters = destinationBoundary.distanceAlongRouteMeters -
                        startBoundary.distanceAlongRouteMeters
                    destinationBoundary to removedDistanceMeters
                }
                .filter { (_, removedDistanceMeters) ->
                    removedDistanceMeters >= excessDistanceMeters + MinimumChordDistanceMeters &&
                        removedDistanceMeters <= excessDistanceMeters + MaximumChordDistanceMeters
                }
                .sortedBy { (_, removedDistanceMeters) ->
                    abs(removedDistanceMeters - (excessDistanceMeters + PreferredChordDistanceMeters))
                }
                .take(MaximumDestinationsPerStart)
                .toList()
            if (possibleDestinations.isEmpty()) {
                return@forEach
            }

            val accessRoutes = TrailRouteAccessPathFinderSijko.findRoutes(
                accessGraph = accessGraph,
                start = startBoundary.point,
                destinations = possibleDestinations.map { (boundary, _) -> boundary.point },
                maxEndpointSnapMeters = MaximumEndpointSnapMeters,
                snapCandidateLimit = EndpointSnapCandidateLimit,
                cancellationCheckpoint = cancellationCheckpoint,
            )
            possibleDestinations.zip(accessRoutes).forEach { (destinationWithDistance, accessRoute) ->
                cancellationCheckpoint()
                val route = accessRoute ?: return@forEach
                val destinationBoundary = destinationWithDistance.first
                if (route.edges.isEmpty() || route.estimatedGapDistanceMeters() > MaximumEstimatedGapMeters) {
                    return@forEach
                }
                val candidateEdges = routeEdges.subList(0, startBoundary.edgeIndex) +
                    route.edges +
                    routeEdges.subList(destinationBoundary.edgeIndex, routeEdges.size)
                val candidateDistanceMeters = candidateEdges.sumOf { edge -> edge.distanceMeters }
                if (abs(candidateDistanceMeters - targetDistanceMeters) <
                    abs(routeDistanceMeters - targetDistanceMeters)
                ) {
                    candidates += candidateEdges
                }
            }
        }

        return candidates
            .distinctBy { edges -> ExerciseRouteKeySijko.keyFor(ExerciseRouteTraversalSijko.traversalFor(edges)) }
            .sortedBy { edges -> abs(edges.sumOf { edge -> edge.distanceMeters } - targetDistanceMeters) }
            .take(MaximumReturnedCandidates)
    }

    private fun sampledBoundaries(
        routeEdges: List<TrailGraphEdge>,
        routeDistanceMeters: Double,
    ): List<ExerciseRouteShortcutBoundary> {
        val allBoundaries = mutableListOf<ExerciseRouteShortcutBoundary>()
        var distanceAlongRouteMeters = 0.0
        routeEdges.forEachIndexed { index, edge ->
            edge.startPoint()?.let { point ->
                if (distanceAlongRouteMeters >= ProtectedEndpointDistanceMeters &&
                    distanceAlongRouteMeters <= routeDistanceMeters - ProtectedEndpointDistanceMeters
                ) {
                    allBoundaries += ExerciseRouteShortcutBoundary(
                        edgeIndex = index,
                        distanceAlongRouteMeters = distanceAlongRouteMeters,
                        point = point,
                    )
                }
            }
            distanceAlongRouteMeters += edge.distanceMeters
        }
        if (allBoundaries.size <= MaximumStartBoundaries) {
            return allBoundaries
        }
        val stride = ceil(allBoundaries.size.toDouble() / MaximumStartBoundaries).toInt()
        return allBoundaries.filterIndexed { index, _ -> index % stride == 0 }
    }

    private fun TrailGraphEdge.startPoint(): MapPoint? {
        return routeSegments.firstOrNull()?.points?.firstOrNull()
    }

    private fun TrailRoute.estimatedGapDistanceMeters(): Double {
        return segments
            .filter { segment -> segment.type == TrailRouteSegmentType.Access && !segment.isRouted }
            .sumOf { segment -> TrailDistanceSijko.pathLengthMeters(segment.points) }
    }

    private const val MaximumStartBoundaries = 32
    private const val MaximumDestinationsPerStart = 24
    private const val MaximumReturnedCandidates = 64
    private const val EndpointSnapCandidateLimit = 3
    private const val ProtectedEndpointDistanceMeters = 300.0
    private const val MinimumChordDistanceMeters = 250.0
    private const val PreferredChordDistanceMeters = 1_200.0
    private const val MaximumChordDistanceMeters = 3_500.0
    private const val MaximumEndpointSnapMeters = 120.0
    private const val MaximumEstimatedGapMeters = 30.0
}
