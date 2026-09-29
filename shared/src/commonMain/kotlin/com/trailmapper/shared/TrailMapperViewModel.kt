/**
 * Job: Own lifecycle-scoped app state for saved items, account actions, and destination navigation.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.TrailAccountSheetSijko
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.trailmapper.shared.routing.AccessGraphBuilderSijko
import com.trailmapper.shared.routing.TrailGraph
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteCalculationSijko
import com.trailmapper.shared.routing.TrailRouteSearchOutcome
import com.trailmapper.shared.routing.TrailNetworkFeature
import com.trailmapper.shared.sijko.CurrentLocationResultMessageSijko
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.MapPointLabelSijko
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import com.trailmapper.shared.sijko.RouteLayerSelection
import com.trailmapper.shared.sijko.SavedDestinationTitleSijko
import com.trailmapper.shared.sijko.SavedItemTitleEditSijko
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal class TrailMapperViewModel(
    private val savedTrailRouteStore: SavedTrailRouteStore,
    private val savedDestinationStore: SavedDestinationStore,
    private val trailAccountProvider: TrailAccountProvider,
    private val recentTrailRouteStore: RecentTrailRouteStore = NoRecentTrailRouteStore,
    private val nowEpochMillis: () -> Long = { Clock.System.now().toEpochMilliseconds() },
) : ViewModel() {
    private val _uiState = MutableStateFlow(TrailMapperUiState())
    val uiState: StateFlow<TrailMapperUiState> = _uiState

    private val savedRouteOperations = Mutex()
    private val savedDestinationOperations = Mutex()
    private var accountJob: Job? = null
    private var destinationNavigationJob: Job? = null
    private var cachedAccessGraph: TrailGraph? = null
    private var cachedAccessGraphEndpointPoints: List<MapPoint> = emptyList()

    init {
        refreshSavedItems()
        refreshAccount()
    }

    fun refreshSavedItems() {
        refreshSavedRoutes()
        refreshSavedDestinations()
        refreshRecentRoutes()
    }

    fun refreshRecentRoutes() {
        viewModelScope.launch {
            val now = nowEpochMillis()
            val recent = try {
                RecentTrailRouteHistorySijko.load(recentTrailRouteStore, savedTrailRouteStore, now)
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                // Recent is a convenience; an unreadable history just shows nothing.
                emptyList()
            }
            _uiState.update { it.copy(recentRoutes = recent, recentRoutesLoadedAtEpochMillis = now) }
        }
    }

    // Entries removed since the last Clear; only these can be put back by Undo.
    private val restorableRecentIds = mutableSetOf<String>()

    fun removeRecentRoute(entry: RecentTrailRoute) {
        restorableRecentIds += entry.id
        _uiState.update { state -> state.copy(recentRoutes = state.recentRoutes.filterNot { it.id == entry.id }) }
        viewModelScope.launch {
            runRecentOperation { RecentTrailRouteHistorySijko.remove(recentTrailRouteStore, entry.id) }
            refreshRecentRoutes()
        }
    }

    /** Undo for Remove; ignored once Clear has run or the entry was already put back. */
    fun restoreRecentRoute(entry: RecentTrailRoute) {
        if (!restorableRecentIds.remove(entry.id)) return
        viewModelScope.launch {
            runRecentOperation {
                RecentTrailRouteHistorySijko.restore(recentTrailRouteStore, savedTrailRouteStore, entry, nowEpochMillis())
            }
            refreshRecentRoutes()
        }
    }

    /** Clears Recent only; saved routes and places are separate and untouched. */
    fun clearRecentRoutes() {
        restorableRecentIds.clear()
        _uiState.update { it.copy(recentRoutes = emptyList()) }
        viewModelScope.launch {
            runRecentOperation { RecentTrailRouteHistorySijko.clear(recentTrailRouteStore) }
            refreshRecentRoutes()
        }
    }

    private suspend fun runRecentOperation(operation: suspend () -> Unit) {
        try {
            operation()
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            Unit
        }
    }

    fun refreshSavedRoutes() {
        launchSavedRouteOperation {
            _uiState.update { it.copy(isLoadingSavedRoutes = true) }
            try {
                val routes = savedTrailRouteStore.savedRoutes()
                _uiState.update { it.copy(savedRoutes = routes) }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update { it.copy(saveMessage = "Unable to load saved routes.") }
            } finally {
                _uiState.update { it.copy(isLoadingSavedRoutes = false) }
            }
        }
    }

    fun refreshSavedDestinations() {
        launchSavedDestinationOperation {
            _uiState.update { it.copy(isLoadingSavedDestinations = true) }
            try {
                val destinations = savedDestinationStore.savedDestinations()
                _uiState.update { it.copy(savedDestinations = destinations) }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update { it.copy(destinationMessage = "Unable to load saved destinations.") }
            } finally {
                _uiState.update { it.copy(isLoadingSavedDestinations = false) }
            }
        }
    }

    fun saveRoute(route: TrailRoute) {
        launchSavedRouteOperation {
            val title = TrailRoutePreviewSavingSijko.defaultTitleFor(route, _uiState.value.savedRoutes)
            try {
                val savedRoute = savedTrailRouteStore.saveRoute(route, title)
                _uiState.update { state ->
                    state.copy(
                        savedRoutes = (listOf(savedRoute) + state.savedRoutes)
                            .distinctBy { saved -> saved.id },
                        saveMessage = "${savedRoute.title} saved.",
                    )
                }
                runRecentOperation { RecentTrailRouteHistorySijko.forget(recentTrailRouteStore, route) }
                refreshRecentRoutes()
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update { it.copy(saveMessage = "Unable to save route.") }
            }
        }
    }

    fun saveDestination(
        address: String,
        point: MapPoint,
        customName: String? = null,
    ) {
        val destinationAddress = address.takeIf { it.isNotBlank() } ?: MapPointLabelSijko.labelFor(point)
        launchSavedDestinationOperation {
            val title = SavedDestinationTitleSijko.titleFor(
                address = destinationAddress,
                savedDestinationCount = _uiState.value.savedDestinations.size,
                customName = customName,
            )
            try {
                val savedDestination = savedDestinationStore.saveDestination(
                    title = title,
                    address = destinationAddress,
                    point = point,
                )
                _uiState.update { state ->
                    state.copy(
                        savedDestinations = (listOf(savedDestination) + state.savedDestinations)
                            .distinctBy { saved -> saved.id },
                        destinationMessage = "${savedDestination.title} saved.",
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update { it.copy(destinationMessage = "Unable to save destination.") }
            }
        }
    }

    fun renameSavedRoute(
        id: String,
        title: String,
    ) {
        val normalizedTitle = SavedItemTitleEditSijko.normalizedTitle(title) ?: return
        launchSavedRouteOperation {
            try {
                val renamedRoute = savedTrailRouteStore.renameRoute(
                    id = id,
                    title = normalizedTitle,
                )
                if (renamedRoute == null) {
                    _uiState.update { it.copy(saveMessage = "Saved route was not found.") }
                    return@launchSavedRouteOperation
                }
                _uiState.update { state ->
                    state.copy(
                        savedRoutes = state.savedRoutes.map { savedRoute ->
                            if (savedRoute.id == id) renamedRoute else savedRoute
                        },
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update { it.copy(saveMessage = "Unable to rename saved route.") }
            }
        }
    }

    fun deleteSavedRoute(id: String) {
        launchSavedRouteOperation {
            try {
                if (!savedTrailRouteStore.deleteRoute(id)) {
                    _uiState.update { it.copy(saveMessage = "Saved route was not found.") }
                    return@launchSavedRouteOperation
                }
                _uiState.update { state ->
                    state.copy(
                        savedRoutes = state.savedRoutes.filterNot { savedRoute -> savedRoute.id == id },
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update { it.copy(saveMessage = "Unable to delete saved route.") }
            }
        }
    }

    fun renameSavedDestination(
        id: String,
        title: String,
    ) {
        val normalizedTitle = SavedItemTitleEditSijko.normalizedTitle(title) ?: return
        launchSavedDestinationOperation {
            try {
                val renamedDestination = savedDestinationStore.renameDestination(
                    id = id,
                    title = normalizedTitle,
                )
                if (renamedDestination == null) {
                    _uiState.update { it.copy(destinationMessage = "Saved destination was not found.") }
                    return@launchSavedDestinationOperation
                }
                _uiState.update { state ->
                    state.copy(
                        savedDestinations = state.savedDestinations.map { savedDestination ->
                            if (savedDestination.id == id) renamedDestination else savedDestination
                        },
                        pendingNavigationDestination = state.pendingNavigationDestination?.let { destination ->
                            if (destination.id == id) renamedDestination else destination
                        },
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update { it.copy(destinationMessage = "Unable to rename saved destination.") }
            }
        }
    }

    fun deleteSavedDestination(id: String) {
        launchSavedDestinationOperation {
            try {
                if (!savedDestinationStore.deleteDestination(id)) {
                    _uiState.update { it.copy(destinationMessage = "Saved destination was not found.") }
                    return@launchSavedDestinationOperation
                }
                if (_uiState.value.navigatingDestinationId == id) {
                    destinationNavigationJob?.cancel()
                }
                _uiState.update { state ->
                    state.copy(
                        savedDestinations = state.savedDestinations.filterNot { destination -> destination.id == id },
                        pendingNavigationDestination = state.pendingNavigationDestination
                            ?.takeUnless { destination -> destination.id == id },
                        navigatingDestinationId = state.navigatingDestinationId
                            ?.takeUnless { destinationId -> destinationId == id },
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update { it.copy(destinationMessage = "Unable to delete saved destination.") }
            }
        }
    }

    fun requestNavigateToDestination(
        destination: SavedDestination,
        currentLocationAddressProvider: CurrentLocationAddressProvider,
        trailNetworkProvider: TrailNetworkProvider,
        accessNetworkProvider: AccessNetworkProvider,
        onRouteFound: (TrailRoute) -> Unit,
    ) {
        if (currentLocationAddressProvider.shouldExplainCurrentLocationAccess()) {
            _uiState.update { it.copy(pendingNavigationDestination = destination) }
            return
        }

        navigateToDestination(
            destination = destination,
            currentLocationAddressProvider = currentLocationAddressProvider,
            trailNetworkProvider = trailNetworkProvider,
            accessNetworkProvider = accessNetworkProvider,
            onRouteFound = onRouteFound,
        )
    }

    fun confirmNavigateToDestination(
        currentLocationAddressProvider: CurrentLocationAddressProvider,
        trailNetworkProvider: TrailNetworkProvider,
        accessNetworkProvider: AccessNetworkProvider,
        onRouteFound: (TrailRoute) -> Unit,
    ) {
        val destination = _uiState.value.pendingNavigationDestination ?: return
        _uiState.update { it.copy(pendingNavigationDestination = null) }
        navigateToDestination(
            destination = destination,
            currentLocationAddressProvider = currentLocationAddressProvider,
            trailNetworkProvider = trailNetworkProvider,
            accessNetworkProvider = accessNetworkProvider,
            onRouteFound = onRouteFound,
        )
    }

    fun dismissNavigateToDestinationPrompt() {
        _uiState.update { it.copy(pendingNavigationDestination = null) }
    }

    fun signInWithGoogle() {
        accountJob?.cancel()
        accountJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isResolvingAccount = true,
                    accountMessage = null,
                )
            }
            when (val result = trailAccountProvider.signIn()) {
                is TrailAccountResult.Success -> {
                    _uiState.update {
                        it.copy(
                            account = result.account,
                            isResolvingAccount = false,
                            accountMessage = "Signed in as ${result.account.displayName}.",
                        )
                    }
                }

                is TrailAccountResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isResolvingAccount = false,
                            accountMessage = result.message,
                        )
                    }
                }

                TrailAccountResult.Cancelled -> {
                    _uiState.update { it.copy(isResolvingAccount = false) }
                }

                TrailAccountResult.Unavailable -> {
                    _uiState.update {
                        it.copy(
                            isResolvingAccount = false,
                            accountMessage = "Google sign-in is not available in this build.",
                        )
                    }
                }
            }
        }
    }

    fun signOut() {
        accountJob?.cancel()
        accountJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isResolvingAccount = true,
                    accountMessage = null,
                )
            }
            trailAccountProvider.signOut()
            _uiState.update {
                it.copy(
                    account = null,
                    isResolvingAccount = false,
                    accountMessage = TrailAccountSheetSijko.SIGNED_OUT_NOTICE,
                )
            }
        }
    }

    fun dismissSaveMessage() {
        _uiState.update { it.copy(saveMessage = null) }
    }

    fun dismissDestinationMessage() {
        _uiState.update { it.copy(destinationMessage = null) }
    }

    fun dismissAccountMessage() {
        _uiState.update { it.copy(accountMessage = null) }
    }

    private fun launchSavedRouteOperation(operation: suspend () -> Unit) {
        viewModelScope.launch {
            savedRouteOperations.withLock {
                operation()
            }
        }
    }

    private fun launchSavedDestinationOperation(operation: suspend () -> Unit) {
        viewModelScope.launch {
            savedDestinationOperations.withLock {
                operation()
            }
        }
    }

    private fun refreshAccount() {
        accountJob?.cancel()
        accountJob = viewModelScope.launch {
            val account = trailAccountProvider.currentAccount()
            _uiState.update { it.copy(account = account) }
        }
    }

    private fun navigateToDestination(
        destination: SavedDestination,
        currentLocationAddressProvider: CurrentLocationAddressProvider,
        trailNetworkProvider: TrailNetworkProvider,
        accessNetworkProvider: AccessNetworkProvider,
        onRouteFound: (TrailRoute) -> Unit,
    ) {
        destinationNavigationJob?.cancel()
        destinationNavigationJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    navigatingDestinationId = destination.id,
                    destinationMessage = null,
                )
            }

            try {
                val currentLocation = currentLocationAddressProvider.getCurrentAddress()
                val startPoint = when (currentLocation) {
                    is CurrentLocationAddressResult.Success -> {
                        currentLocation.point ?: run {
                            _uiState.update {
                                it.copy(
                                    navigatingDestinationId = null,
                                    destinationMessage = "Current location did not include routeable coordinates.",
                                )
                            }
                            return@launch
                        }
                    }

                    CurrentLocationAddressResult.PermissionDenied,
                    CurrentLocationAddressResult.LocationServicesDisabled,
                    CurrentLocationAddressResult.LocationUnavailable,
                    is CurrentLocationAddressResult.Error,
                    -> {
                        _uiState.update {
                            it.copy(
                                navigatingDestinationId = null,
                                destinationMessage = CurrentLocationResultMessageSijko.messageFor(currentLocation)
                                    ?: "Unable to get current location.",
                            )
                        }
                        return@launch
                    }
                }

                val loadResult = trailNetworkProvider.loadTrailNetwork()
                val outcome = when (loadResult) {
                    is TrailNetworkLoadResult.Success -> {
                        findTrailRoute(
                            features = loadResult.features,
                            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                            startPoint = startPoint,
                            destinationPoint = destination.point,
                            accessNetworkProvider = accessNetworkProvider,
                        )
                    }

                    TrailNetworkLoadResult.Unavailable -> {
                        _uiState.update {
                            it.copy(
                                navigatingDestinationId = null,
                                destinationMessage = "This build does not have trail-network route data available.",
                            )
                        }
                        return@launch
                    }

                    is TrailNetworkLoadResult.Error -> {
                        _uiState.update {
                            it.copy(
                                navigatingDestinationId = null,
                                destinationMessage = loadResult.message,
                            )
                        }
                        return@launch
                    }
                }

                val route = outcome.route
                val closure = outcome.blockingClosures.firstOrNull()
                if (route == null) {
                    _uiState.update {
                        it.copy(
                            navigatingDestinationId = null,
                            destinationMessage = closure?.let { blocked -> "${blocked.title}. ${blocked.guidance}" }
                                ?: "No approved trail route was found from your current location to ${destination.title}.",
                        )
                    }
                } else {
                    _uiState.update { it.copy(navigatingDestinationId = null) }
                    onRouteFound(route)
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update {
                    it.copy(
                        navigatingDestinationId = null,
                        destinationMessage = exception.message ?: "Destination navigation failed.",
                    )
                }
            }
        }
    }

    private suspend fun findTrailRoute(
        features: List<TrailNetworkFeature>,
        routeLayers: RouteLayerSelection,
        startPoint: MapPoint,
        destinationPoint: MapPoint,
        accessNetworkProvider: AccessNetworkProvider,
    ): TrailRouteSearchOutcome {
        val accessGraph = loadAccessGraph(
            accessNetworkProvider = accessNetworkProvider,
            endpointPoints = listOf(startPoint, destinationPoint),
        )
        return withContext(Dispatchers.Default) {
            val coroutineContext = currentCoroutineContext()
            coroutineContext.ensureActive()
            TrailRouteCalculationSijko.findRouteOutcome(
                features = features,
                routeLayers = routeLayers,
                startPoint = startPoint,
                destinationPoint = destinationPoint,
                accessGraph = accessGraph,
                cancellationCheckpoint = { coroutineContext.ensureActive() },
            )
        }
    }

    private suspend fun loadAccessGraph(
        accessNetworkProvider: AccessNetworkProvider,
        endpointPoints: List<MapPoint>,
    ): TrailGraph? {
        cachedAccessGraph
            ?.takeIf { cachedAccessGraphEndpointPoints == endpointPoints }
            ?.let { return it }
        val accessNetwork = accessNetworkProvider.loadAccessNetwork(endpointPoints)
        if (accessNetwork !is AccessNetworkLoadResult.Success) {
            return null
        }

        return withContext(Dispatchers.Default) {
            val coroutineContext = currentCoroutineContext()
            coroutineContext.ensureActive()
            AccessGraphBuilderSijko.buildGraph(
                features = accessNetwork.features,
                cancellationCheckpoint = { coroutineContext.ensureActive() },
            )
        }.also {
            cachedAccessGraph = it
            cachedAccessGraphEndpointPoints = endpointPoints.toList()
        }
    }
}
