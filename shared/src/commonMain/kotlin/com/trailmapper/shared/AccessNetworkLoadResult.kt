/**
 * Job: Represent the outcome of loading ordinary-road access-network data.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.AccessNetworkFeature

sealed interface AccessNetworkLoadResult {
    data class Success(val features: List<AccessNetworkFeature>) : AccessNetworkLoadResult
    data object Unavailable : AccessNetworkLoadResult
    data class Error(val message: String) : AccessNetworkLoadResult
}
