/**
 * Job: Select trail entry or exit snaps by ordinary-road access distance instead of straight-line distance.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object TrailRouteEndpointAccessSelectorSijko {
    fun candidates(
        trailGraph: TrailGraph,
        accessGraph: TrailGraph,
        endpointPoint: MapPoint,
        maxTrailCandidateStraightMeters: Double = 1_500.0,
        maxDirectAccessMeters: Double = 8.0,
        maxAccessRouteMeters: Double = 4_000.0,
        maxEndpointSnapMeters: Double = 250.0,
        roughCandidateLimit: Int = 24,
        resultLimit: Int = 8,
        allowExtendedAccessFallback: Boolean = true,
        extendedMaxTrailCandidateStraightMeters: Double = EXTENDED_MAX_TRAIL_CANDIDATE_STRAIGHT_METERS,
        extendedMaxAccessRouteMeters: Double = EXTENDED_MAX_ACCESS_ROUTE_METERS,
        extendedMaxEndpointSnapMeters: Double = EXTENDED_MAX_ENDPOINT_SNAP_METERS,
        extendedRoughCandidateLimit: Int = EXTENDED_ROUGH_CANDIDATE_LIMIT,
        cancellationCheckpoint: () -> Unit = {},
    ): List<TrailRouteEndpointAccess> {
        if (roughCandidateLimit <= 0 || resultLimit <= 0) {
            return emptyList()
        }

        val conservativeCandidates = candidatesWithinLimits(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = endpointPoint,
            maxTrailCandidateStraightMeters = maxTrailCandidateStraightMeters,
            maxDirectAccessMeters = maxDirectAccessMeters,
            maxAccessRouteMeters = maxAccessRouteMeters,
            maxEndpointSnapMeters = maxEndpointSnapMeters,
            roughCandidateLimit = roughCandidateLimit,
            resultLimit = resultLimit,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        if (conservativeCandidates.isNotEmpty() || !allowExtendedAccessFallback) {
            return conservativeCandidates
        }

        return candidatesWithinLimits(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = endpointPoint,
            maxTrailCandidateStraightMeters = extendedMaxTrailCandidateStraightMeters,
            maxDirectAccessMeters = maxDirectAccessMeters,
            maxAccessRouteMeters = extendedMaxAccessRouteMeters,
            maxEndpointSnapMeters = extendedMaxEndpointSnapMeters,
            roughCandidateLimit = extendedRoughCandidateLimit,
            resultLimit = resultLimit,
            cancellationCheckpoint = cancellationCheckpoint,
        )
    }

    internal fun extendedCandidates(
        trailGraph: TrailGraph,
        accessGraph: TrailGraph,
        endpointPoint: MapPoint,
        cancellationCheckpoint: () -> Unit = {},
    ): List<TrailRouteEndpointAccess> {
        return candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = endpointPoint,
            maxTrailCandidateStraightMeters = EXTENDED_MAX_TRAIL_CANDIDATE_STRAIGHT_METERS,
            maxAccessRouteMeters = EXTENDED_MAX_ACCESS_ROUTE_METERS,
            maxEndpointSnapMeters = EXTENDED_MAX_ENDPOINT_SNAP_METERS,
            roughCandidateLimit = EXTENDED_ROUGH_CANDIDATE_LIMIT,
            allowExtendedAccessFallback = false,
            cancellationCheckpoint = cancellationCheckpoint,
        )
    }

    private fun candidatesWithinLimits(
        trailGraph: TrailGraph,
        accessGraph: TrailGraph,
        endpointPoint: MapPoint,
        maxTrailCandidateStraightMeters: Double,
        maxDirectAccessMeters: Double,
        maxAccessRouteMeters: Double,
        maxEndpointSnapMeters: Double,
        roughCandidateLimit: Int,
        resultLimit: Int,
        cancellationCheckpoint: () -> Unit,
    ): List<TrailRouteEndpointAccess> {
        val snapCandidates = TrailRouteEndpointSnapDiversitySijko.select(
            snaps = NearestTrailSnapSijko.nearestSnaps(
                graph = trailGraph,
                point = endpointPoint,
                limit = trailGraph.edges.size + trailGraph.nodes.size,
                maxAccessDistanceMeters = maxTrailCandidateStraightMeters,
                includeNodeSnaps = true,
                cancellationCheckpoint = cancellationCheckpoint,
            ),
            limit = roughCandidateLimit,
            maxSnapsPerSourceFeature = MAX_ROUGH_SNAPS_PER_SOURCE_FEATURE,
        )
        val directCandidates = snapCandidates
            .filter { it.accessDistanceMeters <= maxDirectAccessMeters }
            .map { snap ->
                TrailRouteEndpointAccessSijko.estimated(
                    endpointPoint = endpointPoint,
                    snap = snap,
                )
            }
        val accessRoutes = TrailRouteAccessPathFinderSijko.findRoutes(
            accessGraph = accessGraph,
            start = endpointPoint,
            destinations = snapCandidates.map { snap -> snap.projectedPoint },
            maxEndpointSnapMeters = maxEndpointSnapMeters,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        val routedCandidates = snapCandidates.zip(accessRoutes).mapNotNull { (snap, accessRoute) ->
            cancellationCheckpoint()
            accessRoute ?: return@mapNotNull null
            val mappedAccessDistanceMeters = accessRoute.mappedAccessDistanceMeters()
            val estimatedAccessDistanceMeters = accessRoute.estimatedAccessDistanceMeters()
            if (accessRoute.totalDistanceMeters > maxAccessRouteMeters ||
                !TrailRouteEndpointAccessClosureSijko.isMeaningful(
                    directDistanceMeters = snap.accessDistanceMeters,
                    mappedDistanceMeters = mappedAccessDistanceMeters,
                    estimatedDistanceMeters = estimatedAccessDistanceMeters,
                    maxDirectEstimatedMeters = maxDirectAccessMeters,
                    minimumMappedDistanceMeters = MINIMUM_MEANINGFUL_MAPPED_ACCESS_METERS,
                    minimumClosureRatio = MINIMUM_MAPPED_CLOSURE_RATIO,
                )
            ) {
                null
            } else {
                TrailRouteEndpointAccessSijko.routed(
                    endpointPoint = endpointPoint,
                    snap = snap,
                    accessRoute = accessRoute,
                )
            }
        }

        return (directCandidates + routedCandidates)
            .distinct()
            .sortedBy(TrailRouteEndpointAccessScoreSijko::score)
            .take(resultLimit)
    }

    private fun TrailRoute.mappedAccessDistanceMeters(): Double {
        return segments
            .filter { it.type == TrailRouteSegmentType.Access && it.isRouted }
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
    }

    private fun TrailRoute.estimatedAccessDistanceMeters(): Double {
        return segments
            .filter { it.type == TrailRouteSegmentType.Access && !it.isRouted }
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
    }

    private const val MINIMUM_MEANINGFUL_MAPPED_ACCESS_METERS = 30.0
    private const val MINIMUM_MAPPED_CLOSURE_RATIO = 0.2
    private const val MAX_ROUGH_SNAPS_PER_SOURCE_FEATURE = 8
    private const val EXTENDED_MAX_TRAIL_CANDIDATE_STRAIGHT_METERS = 6_500.0
    private const val EXTENDED_MAX_ACCESS_ROUTE_METERS = 12_000.0
    private const val EXTENDED_MAX_ENDPOINT_SNAP_METERS = 1_000.0
    private const val EXTENDED_ROUGH_CANDIDATE_LIMIT = 64
}
