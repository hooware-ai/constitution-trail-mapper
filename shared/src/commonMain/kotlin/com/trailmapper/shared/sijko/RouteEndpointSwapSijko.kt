/**
 * Job: Swap the start and destination endpoint values without UI knowledge.
 *
 */
package com.trailmapper.shared.sijko

object RouteEndpointSwapSijko {
    fun swap(endpoints: RouteEndpoints): RouteEndpoints {
        return endpoints.copy(
            start = endpoints.destination,
            destination = endpoints.start,
            startPoint = endpoints.destinationPoint,
            destinationPoint = endpoints.startPoint,
        )
    }
}
