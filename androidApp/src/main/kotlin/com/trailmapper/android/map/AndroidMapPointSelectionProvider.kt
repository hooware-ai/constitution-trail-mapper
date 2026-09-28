/**
 * Job: Bridge shared map-point selection requests to the Android Google Maps picker activity.
 *
 */
package com.trailmapper.android.map

import com.trailmapper.shared.MapPointSelectionProvider
import com.trailmapper.shared.MapPointSelectionResult
import com.trailmapper.shared.sijko.RouteEndpointTarget

class AndroidMapPointSelectionProvider(
    private val requestMapPoint: suspend (RouteEndpointTarget) -> MapPointSelectionResult,
) : MapPointSelectionProvider {
    override suspend fun pickMapPoint(target: RouteEndpointTarget): MapPointSelectionResult {
        return requestMapPoint(target)
    }
}
