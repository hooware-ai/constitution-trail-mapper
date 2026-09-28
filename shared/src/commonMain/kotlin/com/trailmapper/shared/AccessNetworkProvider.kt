/**
 * Job: Provide ordinary-road access-network data to shared route planning.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

interface AccessNetworkProvider {
    suspend fun loadAccessNetwork(relevantEndpointPoints: List<MapPoint>): AccessNetworkLoadResult
}
