/**
 * Job: Provide a safe route-network fallback when a platform has not wired trail data yet.
 *
 */
package com.trailmapper.shared

object NoTrailNetworkProvider : TrailNetworkProvider {
    override suspend fun loadTrailNetwork(): TrailNetworkLoadResult {
        return TrailNetworkLoadResult.Unavailable
    }
}
