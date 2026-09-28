/**
 * Job: Model every result the shared UI can receive while loading trail-network route data.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailNetworkFeature

sealed class TrailNetworkLoadResult {
    data class Success(val features: List<TrailNetworkFeature>) : TrailNetworkLoadResult()
    object Unavailable : TrailNetworkLoadResult()
    data class Error(val message: String) : TrailNetworkLoadResult()
}
