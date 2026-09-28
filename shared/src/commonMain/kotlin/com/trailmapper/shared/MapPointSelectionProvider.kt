/**
 * Job: Define the shared platform boundary for picking a map coordinate.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.RouteEndpointTarget

interface MapPointSelectionProvider {
    suspend fun pickMapPoint(target: RouteEndpointTarget): MapPointSelectionResult
}
