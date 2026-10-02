/**
 * Job: Choose the point that autocomplete suggestions should be measured from, if there is a trustworthy one.
 *
 */
package com.trailmapper.shared.sijko

object AutocompleteProximitySijko {
    /**
     * Destination suggestions are measured from a resolved Start. Typing into Start clears its point, so an
     * unresolved Start gives null and the search keeps its local-area fallback rather than a false anchor.
     */
    fun anchorFor(
        target: RouteEndpointTarget,
        endpoints: RouteEndpoints,
    ): MapPoint? = when (target) {
        RouteEndpointTarget.Destination -> endpoints.startPoint
        RouteEndpointTarget.Start -> null
    }
}
