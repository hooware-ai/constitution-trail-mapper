/**
 * Job: Provide an empty saved-destination store for platforms without persistence wired yet.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

object NoSavedDestinationStore : SavedDestinationStore {
    override suspend fun savedDestinations(): List<SavedDestination> = emptyList()

    override suspend fun saveDestination(
        title: String,
        address: String,
        point: MapPoint,
    ): SavedDestination {
        return SavedDestination(
            id = title,
            title = title,
            address = address,
            point = point,
        )
    }

    override suspend fun renameDestination(
        id: String,
        title: String,
    ): SavedDestination? = null

    override suspend fun deleteDestination(id: String): Boolean = false
}
