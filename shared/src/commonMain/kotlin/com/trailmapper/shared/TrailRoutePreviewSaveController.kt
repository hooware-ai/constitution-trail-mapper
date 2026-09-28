/**
 * Job: Track whether the route a preview shows, and its destination, are saved, and save each at most once.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TrailRoutePreviewSaveState(
    /** The route on screen: the plan, its reverse, or a replacement adopted after a reroute. */
    val shownRoute: TrailRoute? = null,
    val savedRoute: SavedTrailRoute? = null,
    val routeLookupDone: Boolean = false,
    val savingRoute: Boolean = false,
    val destination: TrailRoutePreviewDestination? = null,
    val savedDestination: SavedDestination? = null,
    val destinationLookupDone: Boolean = false,
    val savingDestination: Boolean = false,
) {
    /** Save waits until the lookup says the shown route is not saved, and allows one write at a time. */
    val canSaveRoute: Boolean
        get() = shownRoute != null && routeLookupDone && !savingRoute && savedRoute == null

    val canSaveDestination: Boolean
        get() = destination != null && destinationLookupDone && !savingDestination && savedDestination == null
}

sealed interface TrailRoutePreviewSaveOutcome<out T> {
    data class Done<T>(
        val item: T,
        val alreadySaved: Boolean,
    ) : TrailRoutePreviewSaveOutcome<T>

    /** Not saved now: the lookup is still running, a save is in flight, or it is already saved. */
    data object Ignored : TrailRoutePreviewSaveOutcome<Nothing>

    data object Failed : TrailRoutePreviewSaveOutcome<Nothing>
}

class TrailRoutePreviewSaveController(
    private val routeStore: SavedTrailRouteStore,
    private val destinationStore: SavedDestinationStore,
    private val scope: CoroutineScope,
    private val recentStore: RecentTrailRouteStore = NoRecentTrailRouteStore,
) {
    private val _state = MutableStateFlow(TrailRoutePreviewSaveState())
    val state: StateFlow<TrailRoutePreviewSaveState> = _state.asStateFlow()
    private var routeLookup: Job? = null
    private var destinationLookup: Job? = null

    /** Call whenever the route on screen changes; its saved state is looked up again. */
    fun show(route: TrailRoute) {
        if (_state.value.shownRoute == route) return
        routeLookup?.cancel()
        _state.update { it.copy(shownRoute = route, savedRoute = null, routeLookupDone = false) }
        routeLookup = scope.launch {
            val match = lookup { TrailRoutePreviewSavingSijko.savedMatch(routeStore, route) }
            _state.update { state ->
                if (state.shownRoute == route) state.copy(savedRoute = match, routeLookupDone = true) else state
            }
        }
    }

    fun offerDestination(destination: TrailRoutePreviewDestination?) {
        destinationLookup?.cancel()
        _state.update {
            it.copy(destination = destination, savedDestination = null, destinationLookupDone = destination == null)
        }
        destination ?: return
        destinationLookup = scope.launch {
            val match = lookup { TrailRoutePreviewSavingSijko.savedDestinationMatch(destinationStore, destination.point) }
            _state.update { state ->
                if (state.destination == destination) {
                    state.copy(savedDestination = match, destinationLookupDone = true)
                } else {
                    state
                }
            }
        }
    }

    suspend fun saveShownRoute(): TrailRoutePreviewSaveOutcome<SavedTrailRoute> {
        val current = _state.value
        val route = current.shownRoute
        if (route == null || !current.canSaveRoute) return TrailRoutePreviewSaveOutcome.Ignored
        _state.update { it.copy(savingRoute = true) }
        return try {
            val result = TrailRoutePreviewSavingSijko.saveRoute(routeStore, route)
            _state.update { state -> if (state.shownRoute == route) state.copy(savedRoute = result.item) else state }
            // Saved is now its home; a failure here only leaves an entry the next Recent load hides.
            try {
                RecentTrailRouteHistorySijko.forget(recentStore, route)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                Unit
            }
            TrailRoutePreviewSaveOutcome.Done(result.item, alreadySaved = !result.isNew)
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            TrailRoutePreviewSaveOutcome.Failed
        } finally {
            _state.update { it.copy(savingRoute = false) }
        }
    }

    suspend fun saveDestination(): TrailRoutePreviewSaveOutcome<SavedDestination> {
        val current = _state.value
        val destination = current.destination
        if (destination == null || !current.canSaveDestination) return TrailRoutePreviewSaveOutcome.Ignored
        _state.update { it.copy(savingDestination = true) }
        return try {
            val result = TrailRoutePreviewSavingSijko.saveDestination(destinationStore, destination)
            _state.update { state ->
                if (state.destination == destination) state.copy(savedDestination = result.item) else state
            }
            TrailRoutePreviewSaveOutcome.Done(result.item, alreadySaved = !result.isNew)
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            TrailRoutePreviewSaveOutcome.Failed
        } finally {
            _state.update { it.copy(savingDestination = false) }
        }
    }

    /** Renames the shown route's saved entry; null when the name is blank or the rename failed. */
    suspend fun renameSavedRoute(title: String): SavedTrailRoute? {
        val saved = _state.value.savedRoute ?: return null
        val renamed = try {
            TrailRoutePreviewSavingSijko.renameRoute(routeStore, saved.id, title)
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            null
        } ?: return null
        _state.update { state -> if (state.savedRoute?.id == renamed.id) state.copy(savedRoute = renamed) else state }
        return renamed
    }

    // A failed lookup counts as "not saved"; the idempotent save still prevents a duplicate.
    private suspend fun <T> lookup(block: suspend () -> T?): T? {
        return try {
            block()
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            null
        }
    }
}
