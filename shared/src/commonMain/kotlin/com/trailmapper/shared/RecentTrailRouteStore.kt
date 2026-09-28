/**
 * Job: Persist the recent-route list on the device; the history rules live in RecentTrailRouteHistorySijko.
 *
 */
package com.trailmapper.shared

interface RecentTrailRouteStore {
    suspend fun recentRoutes(): List<RecentTrailRoute>

    suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>)
}

object NoRecentTrailRouteStore : RecentTrailRouteStore {
    override suspend fun recentRoutes(): List<RecentTrailRoute> = emptyList()

    override suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>) = Unit
}
