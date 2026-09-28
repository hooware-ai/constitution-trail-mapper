/**
 * Job: Create, rename, delete, and load drawable trail routes in Android SharedPreferences off the main thread.
 *
 */
package com.trailmapper.android.routing

import android.content.Context
import com.trailmapper.android.map.TrailRouteMapJsonSijko
import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.SavedTrailRouteStore
import com.trailmapper.shared.TrailMapperPersistenceJsonSijko
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteSummarySijko
import com.trailmapper.shared.sijko.SavedItemTitleEditSijko
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class AndroidSavedTrailRouteStore(
    context: Context,
) : SavedTrailRouteStore {
    private val preferences by lazy {
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    }
    private val operationMutex = Mutex()

    override suspend fun savedRoutes(): List<SavedTrailRoute> = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            readRoutes()
        }
    }

    override suspend fun saveRoute(
        route: TrailRoute,
        title: String,
    ): SavedTrailRoute = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            val savedRoute = SavedTrailRoute(
                id = UUID.randomUUID().toString(),
                title = title,
                summary = TrailRouteSummarySijko.summaryFor(route),
                route = route,
            )
            val updatedRoutes = listOf(savedRoute) + readRoutes()
            check(writeRoutes(updatedRoutes)) {
                "Unable to persist saved route."
            }
            savedRoute
        }
    }

    override suspend fun renameRoute(
        id: String,
        title: String,
    ): SavedTrailRoute? = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            val existing = readRoutes()
            val route = existing.firstOrNull { route -> route.id == id }
                ?: return@withContext null
            val normalizedTitle = requireNotNull(SavedItemTitleEditSijko.normalizedTitle(title)) {
                "Saved route title cannot be blank."
            }
            val renamed = route.copy(title = normalizedTitle)
            val updated = existing.map { route ->
                if (route.id == id) renamed else route
            }
            check(writeRoutes(updated)) {
                "Unable to persist saved route."
            }
            renamed
        }
    }

    override suspend fun deleteRoute(id: String): Boolean = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            val existing = readRoutes()
            val updated = existing.filterNot { route -> route.id == id }
            if (updated.size == existing.size) {
                return@withContext false
            }
            check(writeRoutes(updated)) {
                "Unable to persist saved route."
            }
            true
        }
    }

    private fun readRoutes(): List<SavedTrailRoute> {
        val savedRoutesJson = preferences.getString(KEY_ROUTES, null) ?: return emptyList()
        return runCatching {
            val routes = JSONArray(savedRoutesJson)
            (0 until routes.length()).map { index ->
                routes.getJSONObject(index).toSavedTrailRoute()
            }
        }.getOrElse { exception ->
            throw IllegalStateException("Malformed saved routes.", exception)
        }
    }

    private fun writeRoutes(routes: List<SavedTrailRoute>): Boolean {
        return preferences.edit()
            .putString(KEY_ROUTES, JSONArray(routes.map { it.toJson() }).toString())
            .commit()
    }

    private fun JSONObject.toSavedTrailRoute(): SavedTrailRoute {
        return SavedTrailRoute(
            id = getString("id"),
            title = getString("title"),
            summary = getString("summary"),
            route = decodePersistedRoute(getString("routeJson")),
        )
    }

    private fun decodePersistedRoute(routeJson: String): TrailRoute {
        val persistedRoutes = TrailMapperPersistenceJsonSijko.decodeRoutes(routeJson)
        if (persistedRoutes != null) {
            return persistedRoutes.singleOrNull()?.route
                ?: throw IllegalArgumentException("Malformed saved route geometry.")
        }
        return TrailRouteMapJsonSijko.decode(routeJson)
            ?: throw IllegalArgumentException("Malformed saved route geometry.")
    }

    private fun SavedTrailRoute.toJson(): JSONObject {
        return JSONObject()
            .put("id", id)
            .put("title", title)
            .put("summary", summary)
            .put("routeJson", TrailMapperPersistenceJsonSijko.encodeRoutes(listOf(this)))
    }

    private companion object {
        const val PREFERENCES_NAME = "trail_mapper_saved_routes"
        const val KEY_ROUTES = "routes"
    }
}
