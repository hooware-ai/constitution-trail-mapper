/**
 * Job: Carry top-level app shell state for saved routes and save feedback.
 *
 */
package com.trailmapper.shared

data class TrailMapperUiState(
    val savedRoutes: List<SavedTrailRoute> = emptyList(),
    val savedDestinations: List<SavedDestination> = emptyList(),
    /** Unsaved routes planned recently, newest first; never a saved route. */
    val recentRoutes: List<RecentTrailRoute> = emptyList(),
    /** When [recentRoutes] was loaded, for "3 hr ago" labels. */
    val recentRoutesLoadedAtEpochMillis: Long = 0L,
    val account: TrailUserAccount? = null,
    val isLoadingSavedRoutes: Boolean = false,
    val isLoadingSavedDestinations: Boolean = false,
    val isResolvingAccount: Boolean = false,
    val pendingNavigationDestination: SavedDestination? = null,
    val navigatingDestinationId: String? = null,
    val saveMessage: String? = null,
    val destinationMessage: String? = null,
    val accountMessage: String? = null,
)
