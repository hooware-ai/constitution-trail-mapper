/**
 * Job: Provide normalized trail-network features to the shared route planner.
 *
 */
package com.trailmapper.shared

interface TrailNetworkProvider {
    suspend fun loadTrailNetwork(): TrailNetworkLoadResult
}
