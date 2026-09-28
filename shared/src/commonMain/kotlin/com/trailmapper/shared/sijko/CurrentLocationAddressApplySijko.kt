/**
 * Job: Apply a resolved current-location address only to endpoints where that shortcut is allowed.
 *
 */
package com.trailmapper.shared.sijko

object CurrentLocationAddressApplySijko {
    fun applyAddress(
        endpoints: RouteEndpoints,
        target: RouteEndpointTarget,
        address: String,
        point: MapPoint? = null,
    ): RouteEndpoints {
        if (!CurrentLocationEndpointAvailabilitySijko.isAvailableFor(target)) {
            return endpoints
        }
        val resolvedAddress = address.takeIf { it.isNotBlank() } ?: return endpoints
        return when (target) {
            RouteEndpointTarget.Start -> endpoints.copy(
                start = resolvedAddress,
                startPoint = point,
            )
            RouteEndpointTarget.Destination -> endpoints
        }
    }
}
