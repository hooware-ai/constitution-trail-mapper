/**
 * Job: Apply manually typed endpoint text while clearing stale coordinate selections.
 *
 */
package com.trailmapper.shared.sijko

object RouteEndpointTextChangeSijko {
    fun updateText(
        endpoints: RouteEndpoints,
        target: RouteEndpointTarget,
        text: String,
    ): RouteEndpoints {
        return when (target) {
            RouteEndpointTarget.Start -> endpoints.copy(
                start = text,
                startPoint = null,
            )
            RouteEndpointTarget.Destination -> endpoints.copy(
                destination = text,
                destinationPoint = null,
            )
        }
    }
}
