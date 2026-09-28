/**
 * Job: Provide a controllable saved-destination store for shared coroutine lifecycle tests.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint
import kotlinx.coroutines.CompletableDeferred

internal class DestinationStore(
    var destinations: List<SavedDestination> = emptyList(),
    var loadFailure: Throwable? = null,
    var saveFailure: Throwable? = null,
) : SavedDestinationStore {
    var loadGate: CompletableDeferred<Unit>? = null

    override suspend fun savedDestinations(): List<SavedDestination> {
        val snapshot = destinations
        loadGate?.await()
        loadFailure?.let { throw it }
        return snapshot
    }

    override suspend fun saveDestination(
        title: String,
        address: String,
        point: MapPoint,
    ): SavedDestination {
        saveFailure?.let { throw it }
        val savedDestination = SavedDestination(
            id = "destination-${destinations.size + 1}",
            title = title,
            address = address,
            point = point,
        )
        destinations = listOf(savedDestination) + destinations
        return savedDestination
    }

    override suspend fun renameDestination(
        id: String,
        title: String,
    ): SavedDestination? = null

    override suspend fun deleteDestination(id: String): Boolean = false
}
