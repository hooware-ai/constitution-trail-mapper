/**
 * Job: Define the shared platform boundary for creating, renaming, deleting, and loading local destinations.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint

interface SavedDestinationStore {
    suspend fun savedDestinations(): List<SavedDestination>

    suspend fun saveDestination(
        title: String,
        address: String,
        point: MapPoint,
    ): SavedDestination

    suspend fun renameDestination(
        id: String,
        title: String,
    ): SavedDestination?

    suspend fun deleteDestination(id: String): Boolean
}
