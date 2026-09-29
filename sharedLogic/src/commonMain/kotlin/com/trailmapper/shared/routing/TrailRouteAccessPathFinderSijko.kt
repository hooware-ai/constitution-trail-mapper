/**
 * Job: Find ordinary-road endpoint access while tolerating disconnected nearest road snaps.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object TrailRouteAccessPathFinderSijko {
    fun findRoute(
        accessGraph: TrailGraph,
        start: MapPoint,
        destination: MapPoint,
        maxEndpointSnapMeters: Double = 250.0,
        snapCandidateLimit: Int = 4,
        cancellationCheckpoint: () -> Unit = {},
    ): TrailRoute? {
        return findRoutes(
            accessGraph = accessGraph,
            start = start,
            destinations = listOf(destination),
            maxEndpointSnapMeters = maxEndpointSnapMeters,
            snapCandidateLimit = snapCandidateLimit,
            cancellationCheckpoint = cancellationCheckpoint,
        ).singleOrNull()
    }

    fun findRoutes(
        accessGraph: TrailGraph,
        start: MapPoint,
        destinations: List<MapPoint>,
        maxEndpointSnapMeters: Double = 250.0,
        snapCandidateLimit: Int = 4,
        cancellationCheckpoint: () -> Unit = {},
    ): List<TrailRoute?> {
        if (accessGraph.edges.isEmpty() || snapCandidateLimit <= 0) {
            return List(destinations.size) { null }
        }

        val startAccesses = endpointAccesses(
            accessGraph = accessGraph,
            endpointPoint = start,
            maxEndpointSnapMeters = maxEndpointSnapMeters,
            snapCandidateLimit = snapCandidateLimit,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        val destinationAccessGroups = destinations.map { destination ->
            endpointAccesses(
                accessGraph = accessGraph,
                endpointPoint = destination,
                maxEndpointSnapMeters = maxEndpointSnapMeters,
                snapCandidateLimit = snapCandidateLimit,
                cancellationCheckpoint = cancellationCheckpoint,
            )
        }

        return TrailRouteFinderSijko.findRoutes(
            graph = accessGraph,
            startAccesses = startAccesses,
            destinationAccessGroups = destinationAccessGroups,
            graphSegmentType = TrailRouteSegmentType.Access,
            cancellationCheckpoint = cancellationCheckpoint,
        )
    }

    private fun endpointAccesses(
        accessGraph: TrailGraph,
        endpointPoint: MapPoint,
        maxEndpointSnapMeters: Double,
        snapCandidateLimit: Int,
        cancellationCheckpoint: () -> Unit,
    ): List<TrailRouteEndpointAccess> {
        return NearestTrailSnapSijko.nearestSnaps(
            graph = accessGraph,
            point = endpointPoint,
            // Ineligible nearby paths must not consume the eligible road-snap budget.
            limit = accessGraph.edges.size,
            maxAccessDistanceMeters = maxEndpointSnapMeters,
            includeNodeSnaps = false,
            cancellationCheckpoint = cancellationCheckpoint,
        ).filter { snap ->
            TrailAccessEndpointSnapEligibilitySijko.isEligible(
                edge = snap.edge,
                snapDistanceMeters = snap.accessDistanceMeters,
            )
        }
            .take(snapCandidateLimit)
            .map { snap ->
                TrailRouteEndpointAccessSijko.estimated(
                    endpointPoint = endpointPoint,
                    snap = snap,
                )
            }
    }
}
