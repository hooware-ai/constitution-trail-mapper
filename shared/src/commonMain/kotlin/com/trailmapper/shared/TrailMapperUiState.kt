/**
 * Job: Carry top-level app shell state for saved routes and save feedback.
 *
 */
package com.trailmapper.shared

data class TrailMapperUiState(
    val savedRoutes: List<SavedTrailRoute> = emptyList(),
    val savedDestinations: List<SavedDestination> = emptyList(),
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
