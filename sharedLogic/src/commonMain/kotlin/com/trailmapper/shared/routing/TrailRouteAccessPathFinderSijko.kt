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

        val components = connectedComponents(accessGraph, cancellationCheckpoint)
        val startAccesses = endpointAccesses(
            accessGraph = accessGraph,
            components = components,
            endpointPoint = start,
            maxEndpointSnapMeters = maxEndpointSnapMeters,
            snapCandidateLimit = snapCandidateLimit,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        val destinationAccessGroups = destinations.map { destination ->
            endpointAccesses(
                accessGraph = accessGraph,
                components = components,
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
        components: Map<Int, Int>,
        endpointPoint: MapPoint,
        maxEndpointSnapMeters: Double,
        snapCandidateLimit: Int,
        cancellationCheckpoint: () -> Unit,
    ): List<TrailRouteEndpointAccess> {
        val eligibleSnaps = NearestTrailSnapSijko.nearestSnaps(
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
        // Several nearby edges can belong to the same disconnected street. Check
        // other road components before using the remaining budget on more of it.
        val nearestPerComponent = eligibleSnaps.distinctBy { snap -> components[snap.edge.fromNodeId] }
        return (nearestPerComponent + eligibleSnaps)
            .distinct()
            .take(snapCandidateLimit)
            .map { snap ->
                TrailRouteEndpointAccessSijko.estimated(
                    endpointPoint = endpointPoint,
                    snap = snap,
                )
            }
    }

    private fun connectedComponents(
        graph: TrailGraph,
        cancellationCheckpoint: () -> Unit,
    ): Map<Int, Int> {
        val neighbors = mutableMapOf<Int, MutableList<Int>>()
        graph.edges.forEach { edge ->
            neighbors.getOrPut(edge.fromNodeId) { mutableListOf() }.add(edge.toNodeId)
            neighbors.getOrPut(edge.toNodeId) { mutableListOf() }.add(edge.fromNodeId)
        }
        val components = mutableMapOf<Int, Int>()
        graph.nodes.forEach { node ->
            if (node.id in components) return@forEach
            val pending = ArrayDeque<Int>()
            components[node.id] = node.id
            pending.addLast(node.id)
            while (pending.isNotEmpty()) {
                cancellationCheckpoint()
                neighbors[pending.removeFirst()].orEmpty().forEach { neighbor ->
                    if (neighbor !in components) {
                        components[neighbor] = node.id
                        pending.addLast(neighbor)
                    }
                }
            }
        }
        return components
    }
}
