/**
 * Job: Find a trail-first route whose endpoint snaps are chosen by routed ordinary-road access.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object TrailRouteWithAccessFinderSijko {
    fun findRoute(
        trailGraph: TrailGraph,
        accessGraph: TrailGraph,
        start: MapPoint,
        destination: MapPoint,
        cancellationCheckpoint: () -> Unit = {},
    ): TrailRoute? {
        val startCandidates = TrailRouteEndpointAccessSelectorSijko.candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = start,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        val destinationCandidates = TrailRouteEndpointAccessSelectorSijko.candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = destination,
            cancellationCheckpoint = cancellationCheckpoint,
        )

        findBestRoute(
            trailGraph = trailGraph,
            start = start,
            destination = destination,
            startCandidates = startCandidates,
            destinationCandidates = destinationCandidates,
            cancellationCheckpoint = cancellationCheckpoint,
        )?.let { return it }

        cancellationCheckpoint()
        val extendedStarts = TrailRouteEndpointAccessSelectorSijko.extendedCandidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = start,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        val extendedDestinations = TrailRouteEndpointAccessSelectorSijko.extendedCandidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = destination,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        // Retain usable normal entries when the broader search ranks different nearby features.
        val extendedStartCandidates = (startCandidates + extendedStarts).distinct()
        val extendedDestinationCandidates = (destinationCandidates + extendedDestinations).distinct()
        if (extendedStartCandidates == startCandidates && extendedDestinationCandidates == destinationCandidates) {
            return null
        }

        return findBestRoute(
            trailGraph = trailGraph,
            start = start,
            destination = destination,
            startCandidates = extendedStartCandidates,
            destinationCandidates = extendedDestinationCandidates,
            cancellationCheckpoint = cancellationCheckpoint,
        )
    }

    private fun findBestRoute(
        trailGraph: TrailGraph,
        start: MapPoint,
        destination: MapPoint,
        startCandidates: List<TrailRouteEndpointAccess>,
        destinationCandidates: List<TrailRouteEndpointAccess>,
        cancellationCheckpoint: () -> Unit,
    ): TrailRoute? {
        if (startCandidates.isEmpty() || destinationCandidates.isEmpty()) {
            return null
        }

        var bestRoute: TrailRoute? = null
        var bestRouteScore = Double.POSITIVE_INFINITY
        startCandidates.forEach { startAccess ->
            TrailRouteFinderSijko.findRouteAlternatives(
                graph = trailGraph,
                startAccess = startAccess,
                destinationAccesses = destinationCandidates,
                cancellationCheckpoint = cancellationCheckpoint,
            ).forEachIndexed { destinationIndex, routes ->
                cancellationCheckpoint()
                val destinationAccess = destinationCandidates[destinationIndex]
                routes.forEach { route ->
                    val routeScore = route.scoreWithEndpointAccess(
                        start = start,
                        destination = destination,
                        startAccess = startAccess,
                        destinationAccess = destinationAccess,
                    )
                    if (routeScore < bestRouteScore) {
                        bestRouteScore = routeScore
                        bestRoute = route
                    }
                }
            }
        }

        return bestRoute
    }

    private fun TrailRoute.scoreWithEndpointAccess(
        start: MapPoint,
        destination: MapPoint,
        startAccess: TrailRouteEndpointAccess,
        destinationAccess: TrailRouteEndpointAccess,
    ): Double {
        return TrailRouteRatingSijko.score(
            route = this,
            start = start,
            destination = destination,
            endpointAccessScore = TrailRouteEndpointAccessScoreSijko.score(startAccess) +
                TrailRouteEndpointAccessScoreSijko.score(destinationAccess),
        )
    }
}
