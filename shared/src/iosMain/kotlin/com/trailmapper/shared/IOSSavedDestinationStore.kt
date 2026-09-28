/**
 * Job: Create, rename, delete, and load saved destinations from iOS user defaults.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.SavedItemTitleEditSijko
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import platform.Foundation.NSUserDefaults
import platform.Foundation.NSUUID

class IOSSavedDestinationStore : SavedDestinationStore {
    private val userDefaults = NSUserDefaults.standardUserDefaults
    private val operationMutex = Mutex()

    override suspend fun savedDestinations(): List<SavedDestination> = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            readDestinations()
        }
    }

    override suspend fun saveDestination(
        title: String,
        address: String,
        point: MapPoint,
    ): SavedDestination = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            val savedDestination = SavedDestination(
                id = NSUUID().UUIDString,
                title = normalizedTitle(title),
                address = address,
                point = point,
            )
            writeDestinations(listOf(savedDestination) + readDestinations())
            savedDestination
        }
    }

    override suspend fun renameDestination(
        id: String,
        title: String,
    ): SavedDestination? = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            val normalizedTitle = SavedItemTitleEditSijko.normalizedTitle(title) ?: return@withContext null
            val existing = readDestinations()
            val renamed = existing.firstOrNull { destination -> destination.id == id }
                ?.copy(title = normalizedTitle)
                ?: return@withContext null
            writeDestinations(existing.map { destination ->
                if (destination.id == id) renamed else destination
            })
            renamed
        }
    }

    override suspend fun deleteDestination(id: String): Boolean = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            val existing = readDestinations()
            val updated = existing.filterNot { destination -> destination.id == id }
            if (updated.size == existing.size) {
                return@withContext false
            }
            writeDestinations(updated)
            true
        }
    }

    private fun readDestinations(): List<SavedDestination> {
        val serializedDestinations = userDefaults.stringForKey(KEY_DESTINATIONS) ?: return emptyList()
        return checkNotNull(TrailMapperPersistenceJsonSijko.decodeDestinations(serializedDestinations)) {
            "Malformed saved destinations."
        }
    }

    private fun writeDestinations(destinations: List<SavedDestination>) {
        userDefaults.setObject(
            TrailMapperPersistenceJsonSijko.encodeDestinations(destinations),
            forKey = KEY_DESTINATIONS,
        )
    }

    private fun normalizedTitle(title: String): String {
        return requireNotNull(SavedItemTitleEditSijko.normalizedTitle(title)) {
            "Saved destination title cannot be blank."
        }
    }

    private companion object {
        const val KEY_DESTINATIONS = "trail_mapper_saved_destinations"
    }
}
