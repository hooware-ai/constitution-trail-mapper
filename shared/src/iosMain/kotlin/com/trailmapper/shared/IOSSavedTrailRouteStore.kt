/**
 * Job: Create, rename, delete, and load saved trail routes from iOS user defaults.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteSummarySijko
import com.trailmapper.shared.sijko.SavedItemTitleEditSijko
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import platform.Foundation.NSUserDefaults
import platform.Foundation.NSUUID

class IOSSavedTrailRouteStore : SavedTrailRouteStore {
    private val userDefaults = NSUserDefaults.standardUserDefaults
    private val operationMutex = Mutex()

    override suspend fun savedRoutes(): List<SavedTrailRoute> = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            readRoutes()
        }
    }

    override suspend fun saveRoute(
        route: TrailRoute,
        title: String,
    ): SavedTrailRoute = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            val savedRoute = SavedTrailRoute(
                id = NSUUID().UUIDString,
                title = normalizedTitle(title),
                summary = TrailRouteSummarySijko.summaryFor(route),
                route = route,
            )
            writeRoutes(listOf(savedRoute) + readRoutes())
            savedRoute
        }
    }

    override suspend fun renameRoute(
        id: String,
        title: String,
    ): SavedTrailRoute? = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            val normalizedTitle = SavedItemTitleEditSijko.normalizedTitle(title) ?: return@withContext null
            val existing = readRoutes()
            val renamed = existing.firstOrNull { route -> route.id == id }
                ?.copy(title = normalizedTitle)
                ?: return@withContext null
            writeRoutes(existing.map { route ->
                if (route.id == id) renamed else route
            })
            renamed
        }
    }

    override suspend fun replaceRoute(
        id: String,
        route: TrailRoute,
    ): SavedTrailRoute? = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            val existing = readRoutes()
            val replaced = existing.firstOrNull { saved -> saved.id == id }
                ?.copy(route = route, summary = TrailRouteSummarySijko.summaryFor(route))
                ?: return@withContext null
            writeRoutes(existing.map { saved ->
                if (saved.id == id) replaced else saved
            })
            replaced
        }
    }

    override suspend fun deleteRoute(id: String): Boolean = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            val existing = readRoutes()
            val updated = existing.filterNot { route -> route.id == id }
            if (updated.size == existing.size) {
                return@withContext false
            }
            writeRoutes(updated)
            true
        }
    }

    private fun readRoutes(): List<SavedTrailRoute> {
        val serializedRoutes = userDefaults.stringForKey(KEY_ROUTES) ?: return emptyList()
        return checkNotNull(TrailMapperPersistenceJsonSijko.decodeRoutes(serializedRoutes)) {
            "Malformed saved routes."
        }
    }

    private fun writeRoutes(routes: List<SavedTrailRoute>) {
        userDefaults.setObject(
            TrailMapperPersistenceJsonSijko.encodeRoutes(routes),
            forKey = KEY_ROUTES,
        )
    }

    private fun normalizedTitle(title: String): String {
        return requireNotNull(SavedItemTitleEditSijko.normalizedTitle(title)) {
            "Saved route title cannot be blank."
        }
    }

    private companion object {
        const val KEY_ROUTES = "trail_mapper_saved_routes"
    }
}
