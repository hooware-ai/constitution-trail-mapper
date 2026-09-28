/**
 * Job: Preserve the iOS map-point selection boundary until the native iOS Google Maps picker is added.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.RouteEndpointTarget

class IOSMapPointSelectionProvider : MapPointSelectionProvider {
    override suspend fun pickMapPoint(target: RouteEndpointTarget): MapPointSelectionResult {
        return MapPointSelectionResult.Unavailable
    }
}
