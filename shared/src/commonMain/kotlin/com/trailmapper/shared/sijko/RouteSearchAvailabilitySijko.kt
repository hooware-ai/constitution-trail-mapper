/**
 * Job: Decide when a route search can start and say what the rider still needs to give it.
 *
 */
package com.trailmapper.shared.sijko

object RouteSearchAvailabilitySijko {
    /** Routing works from resolved points, so typed text alone is not enough. */
    fun canSearch(endpoints: RouteEndpoints): Boolean {
        return endpoints.start.isNotBlank() &&
            endpoints.startPoint != null &&
            endpoints.destination.isNotBlank() &&
            endpoints.destinationPoint != null
    }

    /** For a field that has text nothing resolved: the rider must pick a suggestion, location or map point. */
    fun unresolvedHint(
        target: RouteEndpointTarget,
        endpoints: RouteEndpoints,
    ): String? {
        val (text, point) = when (target) {
            RouteEndpointTarget.Start -> endpoints.start to endpoints.startPoint
            RouteEndpointTarget.Destination -> endpoints.destination to endpoints.destinationPoint
        }
        if (text.isBlank() || point != null) return null
        val end = if (target == RouteEndpointTarget.Start) "starts" else "ends"
        return "Choose a suggestion, your current location, or a point on the map so the route $end where you mean."
    }

    /** What is still missing from an empty field, in the order the rider would fill them; null once ready. */
    fun guidance(endpoints: RouteEndpoints): String? = when {
        endpoints.start.isBlank() -> "Add a start to find a route."
        endpoints.destination.isBlank() -> "Add a destination to find a route."
        else -> null
    }
}
