/**
 * Job: Save a previewed route or its destination once, with the same default names wherever the rider saves it.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.routing.TrailRouteReverseSijko
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.MapPointLabelSijko
import com.trailmapper.shared.sijko.SavedDestinationTitleSijko
import com.trailmapper.shared.sijko.SavedExerciseRouteTitleSijko
import com.trailmapper.shared.sijko.SavedItemTitleEditSijko
import com.trailmapper.shared.sijko.SavedTrailRouteTitleSijko
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

object TrailRoutePreviewSavingSijko {
    /** A save that found the item already stored reports [isNew] false and does not store it again. */
    data class SaveResult<T>(
        val item: T,
        val isNew: Boolean,
    )

    // The stores give every save a new id, so check-then-save runs one at a time to stay idempotent.
    private val saveMutex = Mutex()

    /** Numbers a new route after the saved routes of its own kind. */
    fun defaultTitleFor(
        route: TrailRoute,
        savedRoutes: List<SavedTrailRoute>,
    ): String {
        val sameKindCount = savedRoutes.count { savedRoute -> savedRoute.route.kind == route.kind }
        return if (route.kind == TrailRouteKind.ExerciseLoop) {
            SavedExerciseRouteTitleSijko.titleFor(sameKindCount)
        } else {
            SavedTrailRouteTitleSijko.titleFor(sameKindCount)
        }
    }

    /** The saved entry holding this route, ridden either way round. */
    suspend fun savedMatch(
        store: SavedTrailRouteStore,
        route: TrailRoute,
    ): SavedTrailRoute? = matchIn(store.savedRoutes(), route)

    suspend fun saveRoute(
        store: SavedTrailRouteStore,
        route: TrailRoute,
    ): SaveResult<SavedTrailRoute> = saveMutex.withLock {
        val existing = store.savedRoutes()
        matchIn(existing, route)?.let { saved -> return@withLock SaveResult(saved, isNew = false) }
        SaveResult(store.saveRoute(route, defaultTitleFor(route, existing)), isNew = true)
    }

    /** Null when the title is blank or the route is no longer saved. */
    suspend fun renameRoute(
        store: SavedTrailRouteStore,
        id: String,
        title: String,
    ): SavedTrailRoute? {
        val normalizedTitle = SavedItemTitleEditSijko.normalizedTitle(title) ?: return null
        return store.renameRoute(id, normalizedTitle)
    }

    /** The saved place at exactly this point. */
    suspend fun savedDestinationMatch(
        store: SavedDestinationStore,
        point: MapPoint,
    ): SavedDestination? = store.savedDestinations().firstOrNull { saved -> saved.point == point }

    suspend fun saveDestination(
        store: SavedDestinationStore,
        destination: TrailRoutePreviewDestination,
    ): SaveResult<SavedDestination> = saveMutex.withLock {
        val existing = store.savedDestinations()
        existing.firstOrNull { saved -> saved.point == destination.point }
            ?.let { saved -> return@withLock SaveResult(saved, isNew = false) }
        val address = destination.address.takeIf { it.isNotBlank() }
            ?: MapPointLabelSijko.labelFor(destination.point)
        val saved = store.saveDestination(
            title = SavedDestinationTitleSijko.titleFor(
                address = address,
                savedDestinationCount = existing.size,
            ),
            address = address,
            point = destination.point,
        )
        SaveResult(saved, isNew = true)
    }

    private fun matchIn(
        savedRoutes: List<SavedTrailRoute>,
        route: TrailRoute,
    ): SavedTrailRoute? {
        val reversed = TrailRouteReverseSijko.reversed(route)
        return savedRoutes.firstOrNull { saved -> saved.route == route || saved.route == reversed }
    }
}
