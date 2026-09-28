/**
 * Job: Keep route planning functional on platforms without ordinary-road access data wired yet.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

object NoAccessNetworkProvider : AccessNetworkProvider {
    override suspend fun loadAccessNetwork(
        relevantEndpointPoints: List<MapPoint>,
    ): AccessNetworkLoadResult {
        return AccessNetworkLoadResult.Unavailable
    }
}
