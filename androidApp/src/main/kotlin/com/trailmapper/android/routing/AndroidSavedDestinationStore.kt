/**
 * Job: Create, rename, delete, and load saved destinations in Android SharedPreferences off the main thread.
 *
 */
package com.trailmapper.android.routing

import android.content.Context
import com.trailmapper.shared.SavedDestination
import com.trailmapper.shared.SavedDestinationStore
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.SavedItemTitleEditSijko
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class AndroidSavedDestinationStore(
    context: Context,
) : SavedDestinationStore {
    private val preferences by lazy {
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    }
    private val operationMutex = Mutex()

    override suspend fun savedDestinations(): List<SavedDestination> = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            readDestinations()
        }
    }

    override suspend fun saveDestination(
        title: String,
        address: String,
        point: MapPoint,
    ): SavedDestination = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            val savedDestination = SavedDestination(
                id = UUID.randomUUID().toString(),
                title = title,
                address = address,
                point = point,
            )
            val updatedDestinations = listOf(savedDestination) + readDestinations()
            check(writeDestinations(updatedDestinations)) {
                "Unable to persist saved destination."
            }
            savedDestination
        }
    }

    override suspend fun renameDestination(
        id: String,
        title: String,
    ): SavedDestination? = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            val existing = readDestinations()
            val destination = existing.firstOrNull { destination -> destination.id == id }
                ?: return@withContext null
            val normalizedTitle = requireNotNull(SavedItemTitleEditSijko.normalizedTitle(title)) {
                "Saved destination title cannot be blank."
            }
            val renamed = destination.copy(title = normalizedTitle)
            val updated = existing.map { destination ->
                if (destination.id == id) renamed else destination
            }
            check(writeDestinations(updated)) {
                "Unable to persist saved destination."
            }
            renamed
        }
    }

    override suspend fun deleteDestination(id: String): Boolean = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            val existing = readDestinations()
            val updated = existing.filterNot { destination -> destination.id == id }
            if (updated.size == existing.size) {
                return@withContext false
            }
            check(writeDestinations(updated)) {
                "Unable to persist saved destination."
            }
            true
        }
    }

    private fun readDestinations(): List<SavedDestination> {
        val savedDestinationsJson = preferences.getString(KEY_DESTINATIONS, null) ?: return emptyList()
        return runCatching {
            val destinations = JSONArray(savedDestinationsJson)
            (0 until destinations.length()).map { index ->
                destinations.getJSONObject(index).toSavedDestination()
            }
        }.getOrElse { exception ->
            throw IllegalStateException("Malformed saved destinations.", exception)
        }
    }

    private fun writeDestinations(destinations: List<SavedDestination>): Boolean {
        return preferences.edit()
            .putString(KEY_DESTINATIONS, JSONArray(destinations.map { it.toJson() }).toString())
            .commit()
    }

    private fun JSONObject.toSavedDestination(): SavedDestination {
        val latitude = getDouble("latitude")
        val longitude = getDouble("longitude")
        check(latitude.isFinite() && longitude.isFinite()) {
            "Saved destination coordinates must be finite."
        }
        return SavedDestination(
            id = getString("id"),
            title = getString("title"),
            address = getString("address"),
            point = MapPoint(latitude = latitude, longitude = longitude),
        )
    }

    private fun SavedDestination.toJson(): JSONObject {
        return JSONObject()
            .put("id", id)
            .put("title", title)
            .put("address", address)
            .put("latitude", point.latitude)
            .put("longitude", point.longitude)
    }

    private companion object {
        const val PREFERENCES_NAME = "trail_mapper_saved_destinations"
        const val KEY_DESTINATIONS = "destinations"
    }
}
