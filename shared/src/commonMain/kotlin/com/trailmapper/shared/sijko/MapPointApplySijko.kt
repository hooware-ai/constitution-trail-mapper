/**
 * Job: Apply a selected map point to the requested route endpoint field.
 *
 */
package com.trailmapper.shared.sijko

object MapPointApplySijko {
    fun applyMapPoint(
        endpoints: RouteEndpoints,
        target: RouteEndpointTarget,
        point: MapPoint,
        address: String? = null,
    ): RouteEndpoints {
        val label = address?.takeIf { it.isNotBlank() } ?: MapPointLabelSijko.labelFor(point)
        return when (target) {
            RouteEndpointTarget.Start -> endpoints.copy(
                start = label,
                startPoint = point,
            )
            RouteEndpointTarget.Destination -> endpoints.copy(
                destination = label,
                destinationPoint = point,
            )
        }
    }
}
