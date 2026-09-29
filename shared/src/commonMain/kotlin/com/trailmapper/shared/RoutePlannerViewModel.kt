/**
 * Job: Own route-planner state and lifecycle-scoped coroutine work for shared UI.
 *
 */
package com.trailmapper.shared

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.trailmapper.shared.routing.AccessGraphBuilderSijko
import com.trailmapper.shared.routing.TrailGraph
import com.trailmapper.shared.routing.TrailRouteCalculationSijko
import com.trailmapper.shared.routing.TrailRouteSearchOutcome
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteSummarySijko
import com.trailmapper.shared.routing.TrailNetworkFeature
import com.trailmapper.shared.sijko.AddressAutocompleteQuerySijko
import com.trailmapper.shared.sijko.AddressPredictionRankingSijko
import com.trailmapper.shared.sijko.AutocompleteProximitySijko
import com.trailmapper.shared.sijko.CurrentLocationAddressApplySijko
import com.trailmapper.shared.sijko.CurrentLocationEndpointAvailabilitySijko
import com.trailmapper.shared.sijko.CurrentLocationResultMessageSijko
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.MapPointApplySijko
import com.trailmapper.shared.sijko.MapPointSelectionResultMessageSijko
import com.trailmapper.shared.sijko.RouteEndpointSwapSijko
import com.trailmapper.shared.sijko.RouteEndpointTarget
import com.trailmapper.shared.sijko.RouteEndpointTextChangeSijko
import com.trailmapper.shared.sijko.RouteEndpoints
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import com.trailmapper.shared.sijko.RouteLayerSelection
import com.trailmapper.shared.sijko.RouteLayerToggleSijko
import com.trailmapper.shared.sijko.TrailRouteLayer
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal class RoutePlannerViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(
        RoutePlannerUiState(
            endpoints = RouteEndpoints(),
            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
        ),
    )
    val uiState: StateFlow<RoutePlannerUiState> = _uiState

    init {
        // Start can resolve at any time (current location, map, a selection); Destination suggestions
        // measured from the old Start must not outlive it.
        viewModelScope.launch {
            _uiState
                .map { state -> state.endpoints.startPoint }
                .distinctUntilChanged()
                .collect { refreshDestinationSuggestionsForNewStart() }
        }
    }

    private var currentLocationJob: Job? = null
    private var mapPointJob: Job? = null
    private var routeSearchJob: Job? = null
    private var routeRequestVersion = 0L
    private var autocompleteJob: Job? = null
    private var autocompleteProvider: AddressAutocompleteProvider? = null

    /** Set while the rider's tapped suggestion is being resolved; a Start change must not disturb it. */
    private var selectionJob: Job? = null
    private var currentLocationRequestTarget: RouteEndpointTarget? = null
    private var mapPointRequestTarget: RouteEndpointTarget? = null
    private var cachedAccessGraph: TrailGraph? = null
    private var cachedAccessGraphEndpointPoints: List<MapPoint> = emptyList()
    private var isPrepared = false

    fun updateEndpointText(
        target: RouteEndpointTarget,
        text: String,
        autocompleteProvider: AddressAutocompleteProvider,
    ) {
        cancelEndpointWork(target)
        invalidateRoute()
        changeState { state ->
            state.copy(
                endpoints = RouteEndpointTextChangeSijko.updateText(
                    endpoints = state.endpoints,
                    target = target,
                    text = text,
                ),
                autocompleteTarget = target,
                autocompleteSuggestions = emptyList(),
                autocompleteError = null,
            )
        }
        requestAutocompletePredictions(
            target = target,
            query = text,
            provider = autocompleteProvider,
        )
    }

    fun swapEndpoints() {
        cancelEndpointWork()
        invalidateRoute()
        changeState { state ->
            state.copy(endpoints = RouteEndpointSwapSijko.swap(state.endpoints))
        }
    }

    fun setLayerChecked(
        layer: TrailRouteLayer,
        checked: Boolean,
    ) {
        invalidateRoute()
        changeState { state ->
            state.copy(
                routeLayers = RouteLayerToggleSijko.setLayerChecked(
                    selection = state.routeLayers,
                    layer = layer,
                    checked = checked,
                ),
            )
        }
    }

    /** Ends the chance to restore a draft, whether or not one was found. */
    fun closeDraftRestore() {
        draftRestoreOpen = false
    }

    fun prepareRoute(destination: SavedDestination?) {
        if (isPrepared) {
            return
        }
        isPrepared = true
        if (touched) {
            // The rider started typing while a draft was still loading; keep what they typed.
            return
        }
        cancelEndpointWork()
        invalidateRoute()
        _uiState.value = RoutePlannerUiState(
            endpoints = if (destination == null) {
                RouteEndpoints()
            } else {
                RouteEndpoints(
                    destination = destination.address,
                    destinationPoint = destination.point,
                )
            },
            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
        )
    }

    /** Set by any change to the form, so a draft is never restored over something the rider has done. */
    private var touched = false
    private var draftRestoreOpen = true

    private inline fun changeState(transform: (RoutePlannerUiState) -> RoutePlannerUiState) {
        touched = true
        _uiState.update(transform)
    }

    private var discardHook: (() -> Unit)? = null

    /** Called once when the rider really leaves the planner, so its draft can be removed. */
    fun setDiscardHook(hook: (() -> Unit)?) {
        discardHook = hook
    }

    override fun onCleared() {
        discard()
        super.onCleared()
    }

    internal fun discard() {
        discardHook?.invoke()
        discardHook = null
    }

    /** What to keep so this form survives the process being killed; null while it is still empty. */
    fun toDraft(nowEpochMillis: Long): RoutePlannerDraft? {
        val state = _uiState.value
        val untouched = state.endpoints == RouteEndpoints() &&
            state.routeLayers == RouteLayerDefaultsSijko.defaultSelection() &&
            state.lastRoute == null
        if (untouched) return null
        return RoutePlannerDraft(
            savedAtEpochMillis = nowEpochMillis,
            endpoints = state.endpoints,
            routeLayers = state.routeLayers,
            lastRoute = state.lastRoute,
        )
    }

    /**
     * Puts a draft back only while this ViewModel is brand new and the rider has changed nothing, including
     * during the moment the draft was being loaded; a live form is never overwritten.
     */
    fun restoreDraft(draft: RoutePlannerDraft) {
        if (isPrepared || touched || !draftRestoreOpen) {
            return
        }
        isPrepared = true
        _uiState.value = RoutePlannerUiState(
            endpoints = draft.endpoints,
            routeLayers = draft.routeLayers,
            lastRoute = draft.lastRoute,
        )
    }

    fun prefillDestination(destination: SavedDestination) {
        cancelEndpointWork(RouteEndpointTarget.Destination)
        invalidateRoute()
        changeState { state ->
            state.copy(
                endpoints = state.endpoints.copy(
                    destination = destination.address,
                    destinationPoint = destination.point,
                ),
                autocompleteTarget = null,
                autocompleteSuggestions = emptyList(),
                autocompleteError = null,
                routeNotice = null,
            )
        }
    }

    fun requestCurrentLocation(
        target: RouteEndpointTarget,
        provider: CurrentLocationAddressProvider,
    ) {
        if (!CurrentLocationEndpointAvailabilitySijko.isAvailableFor(target)) {
            return
        }
        cancelEndpointWork(target)
        invalidateRoute()
        dismissErrors()
        if (provider.shouldExplainCurrentLocationAccess()) {
            changeState { it.copy(pendingLocationTarget = target) }
        } else {
            resolveCurrentLocation(target, provider)
        }
    }

    fun confirmCurrentLocation(provider: CurrentLocationAddressProvider) {
        val target = uiState.value.pendingLocationTarget ?: return
        changeState { it.copy(pendingLocationTarget = null) }
        if (!CurrentLocationEndpointAvailabilitySijko.isAvailableFor(target)) {
            return
        }
        resolveCurrentLocation(target, provider)
    }

    fun dismissCurrentLocationPrompt() {
        changeState { it.copy(pendingLocationTarget = null) }
    }

    fun requestMapPoint(
        target: RouteEndpointTarget,
        provider: MapPointSelectionProvider,
    ) {
        cancelEndpointWork(target)
        invalidateRoute()
        mapPointJob?.cancel()
        mapPointRequestTarget = target
        mapPointJob = viewModelScope.launch {
            changeState {
                it.copy(
                    resolvingMapPointTarget = target,
                    mapPointError = null,
                    autocompleteSuggestions = emptyList(),
                    autocompleteError = null,
                )
            }
            try {
                val result = provider.pickMapPoint(target)
                currentCoroutineContext().ensureActive()
                changeState { state ->
                    val updatedEndpoints = when (result) {
                        is MapPointSelectionResult.Success -> {
                            MapPointApplySijko.applyMapPoint(
                                endpoints = state.endpoints,
                                target = target,
                                point = result.point,
                                address = result.address,
                            )
                        }
                        MapPointSelectionResult.Cancelled,
                        MapPointSelectionResult.Unavailable,
                        is MapPointSelectionResult.Error,
                        -> state.endpoints
                    }

                    state.copy(
                        endpoints = updatedEndpoints,
                        resolvingMapPointTarget = null,
                        mapPointError = MapPointSelectionResultMessageSijko.messageFor(result),
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                currentCoroutineContext().ensureActive()
                changeState {
                    it.copy(
                        resolvingMapPointTarget = null,
                        mapPointError = exception.message ?: "Map point selection failed.",
                    )
                }
            }
        }
    }

    fun selectAutocompletePrediction(
        target: RouteEndpointTarget,
        prediction: AddressAutocompletePrediction,
        provider: AddressAutocompleteProvider,
    ) {
        cancelEndpointWork(target)
        invalidateRoute()
        autocompleteJob = viewModelScope.launch {
            changeState {
                it.copy(
                    autocompleteTarget = target,
                    isResolvingAutocomplete = true,
                    autocompleteError = null,
                )
            }
            try {
                val result = provider.resolvePrediction(prediction, target)
                currentCoroutineContext().ensureActive()
                changeState { state ->
                    when (result) {
                        is AddressAutocompleteSelectionResult.Success -> state.copy(
                            endpoints = MapPointApplySijko.applyMapPoint(
                                endpoints = state.endpoints,
                                target = target,
                                point = result.point,
                                address = result.address,
                            ),
                            autocompleteSuggestions = emptyList(),
                            autocompleteTarget = null,
                            isResolvingAutocomplete = false,
                            autocompleteError = null,
                        )
                        is AddressAutocompleteSelectionResult.Error -> state.copy(
                            isResolvingAutocomplete = false,
                            autocompleteError = result.message,
                        )
                        AddressAutocompleteSelectionResult.Unavailable -> state.copy(
                            isResolvingAutocomplete = false,
                            autocompleteError = "Address autocomplete is unavailable.",
                        )
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                currentCoroutineContext().ensureActive()
                changeState {
                    it.copy(
                        isResolvingAutocomplete = false,
                        autocompleteError = exception.message ?: "Address autocomplete failed.",
                    )
                }
            }
        }
        selectionJob = autocompleteJob
    }

    fun findTrailRoute(
        trailNetworkProvider: TrailNetworkProvider,
        accessNetworkProvider: AccessNetworkProvider,
    ) {
        if (uiState.value.hasPendingEndpointRequest) {
            return
        }
        invalidateRoute()
        val requestVersion = routeRequestVersion
        val snapshot = uiState.value
        val startPoint = snapshot.endpoints.startPoint
        val destinationPoint = snapshot.endpoints.destinationPoint
        if (startPoint == null || destinationPoint == null) {
            changeState {
                it.copy(
                    routeNotice = RouteNotice(
                        title = "Choose both points",
                        message = "Choose a start and a destination from a suggestion or a point on the map. Your current location works for the start.",
                        retryable = false,
                    ),
                )
            }
            return
        }

        routeSearchJob = viewModelScope.launch {
            changeState {
                it.copy(
                    isFindingRoute = true,
                    routeNotice = null,
                )
            }

            try {
                val loadResult = trailNetworkProvider.loadTrailNetwork()
                currentCoroutineContext().ensureActive()
                val routeNotice = when (loadResult) {
                    is TrailNetworkLoadResult.Success -> {
                        val outcome = findTrailRoute(
                            features = loadResult.features,
                            routeLayers = snapshot.routeLayers,
                            startPoint = startPoint,
                            destinationPoint = destinationPoint,
                            accessNetworkProvider = accessNetworkProvider,
                        )
                        val route = outcome.route
                        val closure = outcome.blockingClosures.firstOrNull()
                        if (route == null && closure != null) {
                            RouteNotice(title = closure.title, message = closure.guidance, retryable = false)
                        } else if (route == null) {
                            RouteNotice(
                                title = "No trail route found",
                                message = "No approved trail route was found within the current access-distance limit. Try points closer to mapped trail segments.",
                                retryable = false,
                            )
                        } else {
                            RouteNotice(
                                title = "Trail route found",
                                message = TrailRouteSummarySijko.summaryFor(route),
                                route = route,
                            )
                        }
                    }
                    TrailNetworkLoadResult.Unavailable -> {
                        RouteNotice(
                            title = "Trail data unavailable",
                            message = "This build does not have trail-network route data available.",
                        )
                    }
                    is TrailNetworkLoadResult.Error -> {
                        RouteNotice(
                            title = "Trail data error",
                            message = loadResult.message,
                        )
                    }
                }
                currentCoroutineContext().ensureActive()
                if (requestVersion != routeRequestVersion) {
                    return@launch
                }
                changeState {
                    it.copy(
                        routeNotice = routeNotice,
                        isFindingRoute = false,
                        lastRoute = routeNotice.route,
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                currentCoroutineContext().ensureActive()
                if (requestVersion != routeRequestVersion) {
                    return@launch
                }
                changeState {
                    it.copy(
                        isFindingRoute = false,
                        routeNotice = RouteNotice(
                            title = "Route search error",
                            message = exception.message ?: "Trail route search failed.",
                        ),
                    )
                }
            }
        }
    }

    fun dismissLocationError() {
        changeState { it.copy(locationError = null) }
    }

    fun dismissMapPointError() {
        changeState { it.copy(mapPointError = null) }
    }

    fun dismissRouteNotice() {
        changeState { it.copy(routeNotice = null) }
    }

    private fun resolveCurrentLocation(
        target: RouteEndpointTarget,
        provider: CurrentLocationAddressProvider,
    ) {
        if (!CurrentLocationEndpointAvailabilitySijko.isAvailableFor(target)) {
            return
        }
        currentLocationJob?.cancel()
        currentLocationRequestTarget = target
        currentLocationJob = viewModelScope.launch {
            changeState {
                it.copy(
                    resolvingLocationTarget = target,
                    locationError = null,
                )
            }
            try {
                val result = provider.getCurrentAddress()
                currentCoroutineContext().ensureActive()
                changeState { state ->
                    val updatedEndpoints = when (result) {
                        is CurrentLocationAddressResult.Success -> {
                            CurrentLocationAddressApplySijko.applyAddress(
                                endpoints = state.endpoints,
                                target = target,
                                address = result.address,
                                point = result.point,
                            )
                        }
                        CurrentLocationAddressResult.PermissionDenied,
                        CurrentLocationAddressResult.LocationServicesDisabled,
                        CurrentLocationAddressResult.LocationUnavailable,
                        is CurrentLocationAddressResult.Error,
                        -> state.endpoints
                    }

                    state.copy(
                        endpoints = updatedEndpoints,
                        resolvingLocationTarget = null,
                        locationError = CurrentLocationResultMessageSijko.messageFor(result),
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                currentCoroutineContext().ensureActive()
                changeState {
                    it.copy(
                        resolvingLocationTarget = null,
                        locationError = exception.message ?: "Current location lookup failed.",
                    )
                }
            }
        }
    }

    private fun dismissErrors() {
        changeState {
            it.copy(
                locationError = null,
                mapPointError = null,
                autocompleteError = null,
                routeNotice = null,
            )
        }
    }

    private fun requestAutocompletePredictions(
        target: RouteEndpointTarget,
        query: String,
        provider: AddressAutocompleteProvider,
    ) {
        autocompleteJob?.cancel()
        autocompleteProvider = provider
        if (!provider.isAvailable || !AddressAutocompleteQuerySijko.shouldSearch(query)) {
            changeState {
                it.copy(
                    autocompleteSuggestions = emptyList(),
                    isResolvingAutocomplete = false,
                )
            }
            return
        }

        autocompleteJob = viewModelScope.launch {
            delay(AUTOCOMPLETE_DEBOUNCE_MILLIS)
            val proximity = AutocompleteProximitySijko.anchorFor(target, _uiState.value.endpoints)
            changeState {
                it.copy(
                    autocompleteTarget = target,
                    isResolvingAutocomplete = true,
                    autocompleteError = null,
                    autocompleteAnchor = proximity,
                )
            }
            try {
                val predictions = AddressPredictionRankingSijko.rankNearestFirst(
                    provider.predictions(query, target, proximity),
                )
                currentCoroutineContext().ensureActive()
                changeState { state ->
                    val stillMeasuredFromStart = AutocompleteProximitySijko.anchorFor(target, state.endpoints) == proximity
                    if (state.autocompleteTarget == target && stillMeasuredFromStart) {
                        state.copy(
                            autocompleteSuggestions = predictions,
                            isResolvingAutocomplete = false,
                        )
                    } else if (state.autocompleteTarget == target) {
                        // Start moved while this was in flight; a refresh for the new Start is on its way.
                        state
                    } else {
                        state.copy(isResolvingAutocomplete = false)
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                currentCoroutineContext().ensureActive()
                changeState {
                    it.copy(
                        autocompleteSuggestions = emptyList(),
                        isResolvingAutocomplete = false,
                        autocompleteError = exception.message ?: "Address autocomplete failed.",
                    )
                }
            }
        }
    }

    /** Drops Destination suggestions measured from a Start that has changed and searches again for the new one. */
    private fun refreshDestinationSuggestionsForNewStart() {
        val state = _uiState.value
        if (state.autocompleteTarget != RouteEndpointTarget.Destination) return
        if (selectionJob?.isActive == true) return
        if (!state.isResolvingAutocomplete && state.autocompleteSuggestions.isEmpty()) return
        val anchor = AutocompleteProximitySijko.anchorFor(RouteEndpointTarget.Destination, state.endpoints)
        if (state.autocompleteAnchor == anchor) return

        // A destination the rider already chose is theirs; only the suggestions change.
        val provider = autocompleteProvider
        if (provider == null || state.endpoints.destinationPoint != null) {
            autocompleteJob?.cancel()
            changeState { it.copy(autocompleteSuggestions = emptyList(), isResolvingAutocomplete = false) }
            return
        }
        changeState { it.copy(autocompleteSuggestions = emptyList()) }
        requestAutocompletePredictions(
            target = RouteEndpointTarget.Destination,
            query = state.endpoints.destination,
            provider = provider,
        )
    }

    private fun invalidateRoute() {
        routeSearchJob?.cancel()
        routeRequestVersion += 1
        changeState { it.copy(isFindingRoute = false, routeNotice = null, lastRoute = null) }
    }

    private fun cancelEndpointWork(target: RouteEndpointTarget? = null) {
        val cancelLocation = target == null || currentLocationRequestTarget == target
        val cancelMapPoint = target == null || mapPointRequestTarget == target
        if (cancelLocation) {
            currentLocationJob?.cancel()
            currentLocationRequestTarget = null
        }
        if (cancelMapPoint) {
            mapPointJob?.cancel()
            mapPointRequestTarget = null
        }
        autocompleteJob?.cancel()
        selectionJob = null
        changeState {
            it.copy(
                resolvingLocationTarget = if (cancelLocation) null else it.resolvingLocationTarget,
                resolvingMapPointTarget = if (cancelMapPoint) null else it.resolvingMapPointTarget,
                pendingLocationTarget = it.pendingLocationTarget.takeUnless { pending ->
                    target == null || pending == target
                },
                autocompleteTarget = null,
                autocompleteSuggestions = emptyList(),
                isResolvingAutocomplete = false,
                autocompleteError = null,
            )
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
        currentCoroutineContext().ensureActive()
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

private const val AUTOCOMPLETE_DEBOUNCE_MILLIS = 300L
