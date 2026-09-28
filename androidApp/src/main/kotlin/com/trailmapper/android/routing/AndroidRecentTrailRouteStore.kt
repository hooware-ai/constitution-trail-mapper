/**
 * Job: Keep the recent-route list in its own SharedPreferences file, which backup rules leave on the device.
 *
 */
package com.trailmapper.android.routing

import android.content.Context
import com.trailmapper.shared.RecentTrailRoute
import com.trailmapper.shared.RecentTrailRouteStore
import com.trailmapper.shared.TrailMapperPersistenceJsonSijko
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AndroidRecentTrailRouteStore(
    context: Context,
) : RecentTrailRouteStore {
    private val preferences by lazy {
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    }

    override suspend fun recentRoutes(): List<RecentTrailRoute> = withContext(Dispatchers.IO) {
        val serialized = preferences.getString(KEY_ROUTES, null) ?: return@withContext emptyList()
        // Recent is disposable history: an unreadable list starts over rather than failing the screen.
        TrailMapperPersistenceJsonSijko.decodeRecentRoutes(serialized) ?: emptyList()
    }

    override suspend fun replaceRecentRoutes(routes: List<RecentTrailRoute>) {
        withContext(Dispatchers.IO) {
            check(
                preferences.edit()
                    .putString(KEY_ROUTES, TrailMapperPersistenceJsonSijko.encodeRecentRoutes(routes))
                    .commit(),
            ) {
                "Unable to persist recent routes."
            }
        }
    }

    companion object {
        /** Excluded by name in res/xml/data_extraction_rules.xml and res/xml/backup_rules.xml. */
        const val PREFERENCES_NAME = "trail_mapper_recent_routes"
        private const val KEY_ROUTES = "routes"
    }
}
