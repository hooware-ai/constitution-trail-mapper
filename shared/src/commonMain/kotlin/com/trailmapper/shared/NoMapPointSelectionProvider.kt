/**
 * Job: Provide a safe fallback map-point picker for previews or unsupported platforms.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.RouteEndpointTarget

object NoMapPointSelectionProvider : MapPointSelectionProvider {
    override suspend fun pickMapPoint(target: RouteEndpointTarget): MapPointSelectionResult {
        return MapPointSelectionResult.Unavailable
    }
}
