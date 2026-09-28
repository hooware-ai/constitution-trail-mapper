/**
 * Job: Replace straight endpoint access estimates with ordinary-road access routes when available.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max

object TrailRouteAccessRoutingSijko {
    fun routeAccessSegments(
        route: TrailRoute,
        accessGraph: TrailGraph,
        maxEndpointSnapMeters: Double = 250.0,
        cancellationCheckpoint: () -> Unit = {},
    ): TrailRoute {
        if (accessGraph.edges.isEmpty() || route.segments.none { it.type == TrailRouteSegmentType.Access && !it.isRouted }) {
            return route
        }

        val reroutedSegments = route.segments.flatMap { segment ->
            cancellationCheckpoint()
            if (segment.type == TrailRouteSegmentType.Access && !segment.isRouted && segment.points.size >= 2) {
                val accessRoute = TrailRouteAccessPathFinderSijko.findRoute(
                    accessGraph = accessGraph,
                    start = segment.points.first(),
                    destination = segment.points.last(),
                    maxEndpointSnapMeters = maxEndpointSnapMeters,
                    cancellationCheckpoint = cancellationCheckpoint,
                )
                accessRoute?.segments ?: listOf(segment)
            } else {
                listOf(segment)
            }
        }

        val mergedSegments = TrailRouteSegmentMergeSijko.merge(reroutedSegments)
        val accessDistanceMeters = mergedSegments
            .filter { it.type == TrailRouteSegmentType.Access }
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
        val originalTrailDistanceMeters = max(
            0.0,
            route.totalDistanceMeters - route.ordinaryAccessDistanceMeters,
        )

        return route.copy(
            segments = mergedSegments,
            totalDistanceMeters = originalTrailDistanceMeters + accessDistanceMeters,
            ordinaryAccessDistanceMeters = accessDistanceMeters,
        )
    }
}
