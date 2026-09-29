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

    private var currentLocationJob: Job? = null
    private var mapPointJob: Job? = null
    private var routeSearchJob: Job? = null
    private var routeRequestVersion = 0L
    private var autocompleteJob: Job? = null
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
        _uiState.update { state ->
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
        _uiState.update { state ->
            state.copy(endpoints = RouteEndpointSwapSijko.swap(state.endpoints))
        }
    }

    fun setLayerChecked(
        layer: TrailRouteLayer,
        checked: Boolean,
    ) {
        invalidateRoute()
        _uiState.update { state ->
            state.copy(
                routeLayers = RouteLayerToggleSijko.setLayerChecked(
                    selection = state.routeLayers,
                    layer = layer,
                    checked = checked,
                ),
            )
        }
    }

    fun prepareRoute(destination: SavedDestination?) {
        if (isPrepared) {
            return
        }
        isPrepared = true
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

    fun prefillDestination(destination: SavedDestination) {
        cancelEndpointWork(RouteEndpointTarget.Destination)
        invalidateRoute()
        _uiState.update { state ->
            state.copy(
                endpoints = state.endpoints.copy(
                    destination = destination.address,
                    destinationPoint = destination.point,
                ),
                autocompleteTarget = null,
                autocompleteSuggestions = emptyList(),
                autocompleteError = null,
                routeDialog = null,
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
            _uiState.update { it.copy(pendingLocationTarget = target) }
        } else {
            resolveCurrentLocation(target, provider)
        }
    }

    fun confirmCurrentLocation(provider: CurrentLocationAddressProvider) {
        val target = uiState.value.pendingLocationTarget ?: return
        _uiState.update { it.copy(pendingLocationTarget = null) }
        if (!CurrentLocationEndpointAvailabilitySijko.isAvailableFor(target)) {
            return
        }
        resolveCurrentLocation(target, provider)
    }

    fun dismissCurrentLocationPrompt() {
        _uiState.update { it.copy(pendingLocationTarget = null) }
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
            _uiState.update {
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
                _uiState.update { state ->
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
                _uiState.update {
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
            _uiState.update {
                it.copy(
                    autocompleteTarget = target,
                    isResolvingAutocomplete = true,
                    autocompleteError = null,
                )
            }
            try {
                val result = provider.resolvePrediction(prediction, target)
                currentCoroutineContext().ensureActive()
                _uiState.update { state ->
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
                _uiState.update {
                    it.copy(
                        isResolvingAutocomplete = false,
                        autocompleteError = exception.message ?: "Address autocomplete failed.",
                    )
                }
            }
        }
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
            _uiState.update {
                it.copy(
                    routeDialog = RouteMessageDialog(
                        title = "Choose points first",
                        message = "Trail routing needs map or current-location points for both start and destination. Typed addresses will route after address geocoding is wired.",
                    ),
                )
            }
            return
        }

        routeSearchJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isFindingRoute = true,
                    routeDialog = null,
                )
            }

            try {
                val loadResult = trailNetworkProvider.loadTrailNetwork()
                currentCoroutineContext().ensureActive()
                val routeDialog = when (loadResult) {
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
                            RouteMessageDialog(title = closure.title, message = closure.guidance)
                        } else if (route == null) {
                            RouteMessageDialog(
                                title = "No trail route found",
                                message = "No approved trail route was found within the current access-distance limit. Try points closer to mapped trail segments.",
                            )
                        } else {
                            RouteMessageDialog(
                                title = "Trail route found",
                                message = TrailRouteSummarySijko.summaryFor(route),
                                route = route,
                            )
                        }
                    }
                    TrailNetworkLoadResult.Unavailable -> {
                        RouteMessageDialog(
                            title = "Trail data unavailable",
                            message = "This build does not have trail-network route data available.",
                        )
                    }
                    is TrailNetworkLoadResult.Error -> {
                        RouteMessageDialog(
                            title = "Trail data error",
                            message = loadResult.message,
                        )
                    }
                }
                currentCoroutineContext().ensureActive()
                if (requestVersion != routeRequestVersion) {
                    return@launch
                }
                _uiState.update {
                    it.copy(
                        routeDialog = routeDialog,
                        isFindingRoute = false,
                        lastRoute = routeDialog.route,
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                currentCoroutineContext().ensureActive()
                if (requestVersion != routeRequestVersion) {
                    return@launch
                }
                _uiState.update {
                    it.copy(
                        isFindingRoute = false,
                        routeDialog = RouteMessageDialog(
                            title = "Route search error",
                            message = exception.message ?: "Trail route search failed.",
                        ),
                    )
                }
            }
        }
    }

    fun dismissLocationError() {
        _uiState.update { it.copy(locationError = null) }
    }

    fun dismissMapPointError() {
        _uiState.update { it.copy(mapPointError = null) }
    }

    fun dismissRouteDialog() {
        _uiState.update { it.copy(routeDialog = null) }
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
            _uiState.update {
                it.copy(
                    resolvingLocationTarget = target,
                    locationError = null,
                )
            }
            try {
                val result = provider.getCurrentAddress()
                currentCoroutineContext().ensureActive()
                _uiState.update { state ->
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
                _uiState.update {
                    it.copy(
                        resolvingLocationTarget = null,
                        locationError = exception.message ?: "Current location lookup failed.",
                    )
                }
            }
        }
    }

    private fun dismissErrors() {
        _uiState.update {
            it.copy(
                locationError = null,
                mapPointError = null,
                autocompleteError = null,
                routeDialog = null,
            )
        }
    }

    private fun requestAutocompletePredictions(
        target: RouteEndpointTarget,
        query: String,
        provider: AddressAutocompleteProvider,
    ) {
        autocompleteJob?.cancel()
        if (!provider.isAvailable || !AddressAutocompleteQuerySijko.shouldSearch(query)) {
            _uiState.update {
                it.copy(
                    autocompleteSuggestions = emptyList(),
                    isResolvingAutocomplete = false,
                )
            }
            return
        }

        autocompleteJob = viewModelScope.launch {
            delay(AUTOCOMPLETE_DEBOUNCE_MILLIS)
            _uiState.update {
                it.copy(
                    autocompleteTarget = target,
                    isResolvingAutocomplete = true,
                    autocompleteError = null,
                )
            }
            try {
                val proximity = AutocompleteProximitySijko.anchorFor(target, _uiState.value.endpoints)
                val predictions = AddressPredictionRankingSijko.rankNearestFirst(
                    provider.predictions(query, target, proximity),
                )
                currentCoroutineContext().ensureActive()
                _uiState.update { state ->
                    if (state.autocompleteTarget == target) {
                        state.copy(
                            autocompleteSuggestions = predictions,
                            isResolvingAutocomplete = false,
                        )
                    } else {
                        state.copy(isResolvingAutocomplete = false)
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                currentCoroutineContext().ensureActive()
                _uiState.update {
                    it.copy(
                        autocompleteSuggestions = emptyList(),
                        isResolvingAutocomplete = false,
                        autocompleteError = exception.message ?: "Address autocomplete failed.",
                    )
                }
            }
        }
    }

    private fun invalidateRoute() {
        routeSearchJob?.cancel()
        routeRequestVersion += 1
        _uiState.update { it.copy(isFindingRoute = false, routeDialog = null, lastRoute = null) }
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
        _uiState.update {
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
