/**
 * Job: Own lifecycle-scoped state and asynchronous work for distance-targeted exercise routes.
 *
 */
package com.trailmapper.shared

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.trailmapper.shared.routing.AccessGraphBuilderSijko
import com.trailmapper.shared.routing.ExerciseRouteCalculationSijko
import com.trailmapper.shared.routing.ExerciseRouteAccessNetworkFilterSijko
import com.trailmapper.shared.routing.ExerciseRouteResult
import com.trailmapper.shared.routing.ExerciseRouteTargetSijko
import com.trailmapper.shared.routing.TrailGraph
import com.trailmapper.shared.sijko.AddressAutocompleteQuerySijko
import com.trailmapper.shared.sijko.CurrentLocationAddressApplySijko
import com.trailmapper.shared.sijko.CurrentLocationResultMessageSijko
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.MapPointApplySijko
import com.trailmapper.shared.sijko.MapPointSelectionResultMessageSijko
import com.trailmapper.shared.sijko.RouteEndpointTarget
import com.trailmapper.shared.sijko.RouteEndpoints
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Clock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal class ExerciseRoutePlannerViewModel(
    private val completedExerciseSessionStore: CompletedExerciseSessionStore,
    private val nowEpochMillis: () -> Long = { Clock.System.now().toEpochMilliseconds() },
) : ViewModel() {
    private val _uiState = MutableStateFlow(ExerciseRoutePlannerUiState())
    val uiState: StateFlow<ExerciseRoutePlannerUiState> = _uiState

    private var locationJob: Job? = null
    private var mapPointJob: Job? = null
    private var autocompleteJob: Job? = null
    private var routeJob: Job? = null
    private var routeRequestVersion = 0L
    private var cachedAccessGraph: TrailGraph? = null
    private var cachedAccessGraphStartPoint: MapPoint? = null
    private var cachedAccessGraphTargetDistanceMeters: Double? = null

    fun updateStartAddress(
        text: String,
        autocompleteProvider: AddressAutocompleteProvider,
    ) {
        cancelStaleWork(cancelLocation = true, cancelMapPoint = true, cancelRoute = true)
        _uiState.update {
            it.copy(
                startAddress = text,
                startPoint = null,
                autocompleteSuggestions = emptyList(),
                isResolvingAutocomplete = false,
                autocompleteError = null,
                result = null,
                searchError = null,
            )
        }
        requestAutocompletePredictions(text, autocompleteProvider)
    }

    fun updateStartText(
        text: String,
        autocompleteProvider: AddressAutocompleteProvider,
    ) = updateStartAddress(text, autocompleteProvider)

    fun setTargetMilesText(text: String) {
        cancelStaleWork(cancelRoute = true)
        _uiState.update {
            it.copy(
                targetMilesText = text,
                result = null,
                searchError = null,
            )
        }
    }

    fun updateTargetMilesText(text: String) = setTargetMilesText(text)

    fun setProposedTrailsEnabled(enabled: Boolean) {
        cancelStaleWork(cancelRoute = true)
        _uiState.update {
            it.copy(
                proposedTrailsEnabled = enabled,
                result = null,
                searchError = null,
            )
        }
    }

    fun setProposedTrails(enabled: Boolean) = setProposedTrailsEnabled(enabled)

    fun requestCurrentLocation(provider: CurrentLocationAddressProvider) {
        cancelStaleWork(cancelAutocomplete = true, cancelMapPoint = true, cancelRoute = true)
        clearTransientErrors()
        if (provider.shouldExplainCurrentLocationAccess()) {
            _uiState.update { it.copy(pendingLocationPrompt = true) }
        } else {
            resolveCurrentLocation(provider)
        }
    }

    fun requestCurrentLocation(
        target: RouteEndpointTarget,
        provider: CurrentLocationAddressProvider,
    ) {
        if (target == RouteEndpointTarget.Start) {
            requestCurrentLocation(provider)
        }
    }

    fun confirmCurrentLocation(provider: CurrentLocationAddressProvider) {
        if (!_uiState.value.pendingLocationPrompt) {
            return
        }
        _uiState.update { it.copy(pendingLocationPrompt = false) }
        resolveCurrentLocation(provider)
    }

    fun dismissCurrentLocationPrompt() {
        _uiState.update { it.copy(pendingLocationPrompt = false) }
    }

    fun requestMapPoint(provider: MapPointSelectionProvider) {
        cancelStaleWork(cancelLocation = true, cancelAutocomplete = true, cancelRoute = true)
        mapPointJob?.cancel()
        mapPointJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isResolvingMapPoint = true,
                    mapPointError = null,
                    autocompleteSuggestions = emptyList(),
                    autocompleteError = null,
                )
            }
            try {
                val selection = provider.pickMapPoint(RouteEndpointTarget.Start)
                currentCoroutineContext().ensureActive()
                _uiState.update { state ->
                    when (selection) {
                        is MapPointSelectionResult.Success -> {
                            val endpoints = MapPointApplySijko.applyMapPoint(
                                endpoints = RouteEndpoints(
                                    start = state.startAddress,
                                    startPoint = state.startPoint,
                                ),
                                target = RouteEndpointTarget.Start,
                                point = selection.point,
                                address = selection.address,
                            )
                            state.copy(
                                startAddress = endpoints.start,
                                startPoint = endpoints.startPoint,
                                isResolvingMapPoint = false,
                                mapPointError = null,
                                result = null,
                                searchError = null,
                            )
                        }
                        MapPointSelectionResult.Cancelled,
                        MapPointSelectionResult.Unavailable,
                        is MapPointSelectionResult.Error,
                        -> state.copy(
                            isResolvingMapPoint = false,
                            mapPointError = MapPointSelectionResultMessageSijko.messageFor(selection),
                        )
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update {
                    it.copy(
                        isResolvingMapPoint = false,
                        mapPointError = exception.message ?: "Map point selection failed.",
                    )
                }
            }
        }
    }

    fun requestMapPoint(
        target: RouteEndpointTarget,
        provider: MapPointSelectionProvider,
    ) {
        if (target == RouteEndpointTarget.Start) {
            requestMapPoint(provider)
        }
    }

    fun selectAutocompletePrediction(
        prediction: AddressAutocompletePrediction,
        provider: AddressAutocompleteProvider,
    ) {
        cancelStaleWork(cancelLocation = true, cancelMapPoint = true, cancelRoute = true)
        autocompleteJob?.cancel()
        autocompleteJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isResolvingAutocomplete = true,
                    autocompleteError = null,
                )
            }
            try {
                val selection = provider.resolvePrediction(prediction, RouteEndpointTarget.Start)
                currentCoroutineContext().ensureActive()
                _uiState.update { state ->
                    when (selection) {
                        is AddressAutocompleteSelectionResult.Success -> {
                            val endpoints = MapPointApplySijko.applyMapPoint(
                                endpoints = RouteEndpoints(
                                    start = state.startAddress,
                                    startPoint = state.startPoint,
                                ),
                                target = RouteEndpointTarget.Start,
                                point = selection.point,
                                address = selection.address,
                            )
                            state.copy(
                                startAddress = endpoints.start,
                                startPoint = endpoints.startPoint,
                                autocompleteSuggestions = emptyList(),
                                isResolvingAutocomplete = false,
                                autocompleteError = null,
                                result = null,
                                searchError = null,
                            )
                        }
                        is AddressAutocompleteSelectionResult.Error -> state.copy(
                            isResolvingAutocomplete = false,
                            autocompleteError = selection.message,
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
                _uiState.update {
                    it.copy(
                        isResolvingAutocomplete = false,
                        autocompleteError = exception.message ?: "Address autocomplete failed.",
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
        if (target == RouteEndpointTarget.Start) {
            selectAutocompletePrediction(prediction, provider)
        }
    }

    fun findExerciseRoute(
        trailNetworkProvider: TrailNetworkProvider,
        accessNetworkProvider: AccessNetworkProvider,
    ) {
        if (uiState.value.hasPendingEndpointRequest) {
            return
        }
        cancelStaleWork(
            cancelLocation = true,
            cancelMapPoint = true,
            cancelAutocomplete = true,
        )
        routeJob?.cancel()
        routeRequestVersion += 1
        val requestVersion = routeRequestVersion
        val snapshot = uiState.value
        val startPoint = snapshot.startPoint
        val targetDistanceMeters = snapshot.targetMilesText.trim().toDoubleOrNull()
            ?.takeIf { it.isFinite() }
            ?.times(METERS_PER_MILE)

        val validationError = when {
            snapshot.startAddress.isBlank() -> "Enter a starting address."
            startPoint == null -> "Choose a starting point from autocomplete, current location, or the map."
            targetDistanceMeters == null || !ExerciseRouteTargetSijko.isValid(targetDistanceMeters) -> {
                "Enter a target distance between 0.5 and 100 miles."
            }
            else -> null
        }
        if (validationError != null) {
            _uiState.update { it.copy(isFindingRoute = false, searchError = validationError) }
            return
        }

        val distanceMeters = targetDistanceMeters ?: return
        val validStartPoint = startPoint ?: return
        routeJob = viewModelScope.launch {
            _uiState.update { it.copy(isFindingRoute = true, searchError = null) }
            try {
                val loaded = coroutineScope {
                    val trailResult = async { trailNetworkProvider.loadTrailNetwork() }
                    val completedSessions = async { completedExerciseSessionStore.completedSessions() }
                    val accessGraph = async {
                        loadAccessGraph(
                            accessNetworkProvider = accessNetworkProvider,
                            startPoint = validStartPoint,
                            targetDistanceMeters = distanceMeters,
                        )
                    }
                    Triple(
                        trailResult.await(),
                        completedSessions.await(),
                        accessGraph.await(),
                    )
                }
                currentCoroutineContext().ensureActive()
                val trailFeatures = when (val trailResult = loaded.first) {
                    TrailNetworkLoadResult.Unavailable -> {
                        finishSearch(requestVersion, "Trail data is unavailable.")
                        return@launch
                    }
                    is TrailNetworkLoadResult.Error -> {
                        finishSearch(
                            requestVersion,
                            trailResult.message.takeIf { it.isNotBlank() } ?: "Trail data could not be loaded.",
                        )
                        return@launch
                    }
                    is TrailNetworkLoadResult.Success -> trailResult.features
                }

                val completedSessions = loaded.second
                val accessGraph = loaded.third
                val result = withContext(Dispatchers.Default) {
                    val context = currentCoroutineContext()
                    context.ensureActive()
                    val routeLayers = RouteLayerDefaultsSijko.defaultSelection().copy(
                        proposedTrails = snapshot.proposedTrailsEnabled,
                    )
                    ExerciseRouteCalculationSijko.findRoute(
                        features = trailFeatures,
                        routeLayers = routeLayers,
                        startPoint = validStartPoint,
                        targetDistanceMeters = distanceMeters,
                        completedSessions = completedSessions,
                        accessGraph = accessGraph,
                        nowEpochMillis = nowEpochMillis(),
                        cancellationCheckpoint = { context.ensureActive() },
                    )
                }
                currentCoroutineContext().ensureActive()
                if (result == null) {
                    finishSearch(requestVersion, "No exercise route found for this start and distance.")
                } else {
                    finishSearch(requestVersion, result = result)
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                finishSearch(
                    requestVersion,
                    error = exception.message ?: "Exercise route search failed.",
                )
            }
        }
    }

    fun findRoute(
        trailNetworkProvider: TrailNetworkProvider,
        accessNetworkProvider: AccessNetworkProvider,
    ) = findExerciseRoute(trailNetworkProvider, accessNetworkProvider)

    fun dismissLocationError() {
        _uiState.update { it.copy(locationError = null) }
    }

    fun dismissMapPointError() {
        _uiState.update { it.copy(mapPointError = null) }
    }

    fun dismissAutocompleteError() {
        _uiState.update { it.copy(autocompleteError = null) }
    }

    fun dismissSearchError() {
        _uiState.update { it.copy(searchError = null) }
    }

    private fun resolveCurrentLocation(provider: CurrentLocationAddressProvider) {
        locationJob?.cancel()
        locationJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isResolvingLocation = true,
                    locationError = null,
                )
            }
            try {
                val location = provider.getCurrentAddress()
                currentCoroutineContext().ensureActive()
                _uiState.update { state ->
                    when (location) {
                        is CurrentLocationAddressResult.Success -> {
                            val endpoints = CurrentLocationAddressApplySijko.applyAddress(
                                endpoints = RouteEndpoints(
                                    start = state.startAddress,
                                    startPoint = state.startPoint,
                                ),
                                target = RouteEndpointTarget.Start,
                                address = location.address,
                                point = location.point,
                            )
                            state.copy(
                                startAddress = endpoints.start,
                                startPoint = endpoints.startPoint,
                                isResolvingLocation = false,
                                locationError = null,
                                result = null,
                                searchError = null,
                            )
                        }
                        CurrentLocationAddressResult.PermissionDenied,
                        CurrentLocationAddressResult.LocationServicesDisabled,
                        CurrentLocationAddressResult.LocationUnavailable,
                        is CurrentLocationAddressResult.Error,
                        -> state.copy(
                            isResolvingLocation = false,
                            locationError = CurrentLocationResultMessageSijko.messageFor(location),
                        )
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update {
                    it.copy(
                        isResolvingLocation = false,
                        locationError = exception.message ?: "Current location lookup failed.",
                    )
                }
            }
        }
    }

    private fun requestAutocompletePredictions(
        query: String,
        provider: AddressAutocompleteProvider,
    ) {
        autocompleteJob?.cancel()
        if (!provider.isAvailable || !AddressAutocompleteQuerySijko.shouldSearch(query)) {
            return
        }

        autocompleteJob = viewModelScope.launch {
            delay(AUTOCOMPLETE_DEBOUNCE_MILLIS)
            currentCoroutineContext().ensureActive()
            _uiState.update { it.copy(isResolvingAutocomplete = true, autocompleteError = null) }
            try {
                val predictions = provider.predictions(query, RouteEndpointTarget.Start)
                currentCoroutineContext().ensureActive()
                if (_uiState.value.startAddress == query) {
                    _uiState.update {
                        it.copy(
                            autocompleteSuggestions = predictions,
                            isResolvingAutocomplete = false,
                        )
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                if (_uiState.value.startAddress == query) {
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
    }

    private suspend fun loadAccessGraph(
        accessNetworkProvider: AccessNetworkProvider,
        startPoint: MapPoint,
        targetDistanceMeters: Double,
    ): TrailGraph? {
        cachedAccessGraph
            ?.takeIf {
                cachedAccessGraphStartPoint == startPoint &&
                    cachedAccessGraphTargetDistanceMeters == targetDistanceMeters
            }
            ?.let { return it }
        val accessResult = accessNetworkProvider.loadAccessNetwork(listOf(startPoint))
        currentCoroutineContext().ensureActive()
        if (accessResult !is AccessNetworkLoadResult.Success) {
            return null
        }
        return withContext(Dispatchers.Default) {
            val context = currentCoroutineContext()
            context.ensureActive()
            AccessGraphBuilderSijko.buildGraph(
                features = ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(
                    features = accessResult.features,
                    startPoint = startPoint,
                    targetDistanceMeters = targetDistanceMeters,
                ),
                cancellationCheckpoint = { context.ensureActive() },
            )
        }.also { graph ->
            cachedAccessGraph = graph
            cachedAccessGraphStartPoint = startPoint
            cachedAccessGraphTargetDistanceMeters = targetDistanceMeters
        }
    }

    private fun finishSearch(
        requestVersion: Long,
        error: String? = null,
        result: ExerciseRouteResult? = null,
    ) {
        if (requestVersion != routeRequestVersion) {
            return
        }
        _uiState.update {
            it.copy(
                isFindingRoute = false,
                searchError = error,
                result = result ?: it.result,
            )
        }
    }

    private fun cancelStaleWork(
        cancelLocation: Boolean = false,
        cancelMapPoint: Boolean = false,
        cancelAutocomplete: Boolean = false,
        cancelRoute: Boolean = false,
    ) {
        if (cancelLocation) {
            locationJob?.cancel()
            _uiState.update { it.copy(isResolvingLocation = false) }
        }
        if (cancelMapPoint) {
            mapPointJob?.cancel()
            _uiState.update { it.copy(isResolvingMapPoint = false) }
        }
        if (cancelAutocomplete) {
            autocompleteJob?.cancel()
            _uiState.update { it.copy(isResolvingAutocomplete = false) }
        }
        if (cancelRoute) {
            routeJob?.cancel()
            routeRequestVersion += 1
            _uiState.update { it.copy(isFindingRoute = false) }
        }
    }

    private fun clearTransientErrors() {
        _uiState.update {
            it.copy(
                locationError = null,
                mapPointError = null,
                autocompleteError = null,
                searchError = null,
            )
        }
    }

    private companion object {
        const val AUTOCOMPLETE_DEBOUNCE_MILLIS = 300L
        const val METERS_PER_MILE = 1_609.344
    }
}
