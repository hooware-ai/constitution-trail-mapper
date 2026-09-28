/**
 * Job: Own lifecycle-scoped state and async work for manually saving destinations.
 *
 */
package com.trailmapper.shared

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.trailmapper.shared.sijko.AddressAutocompleteQuerySijko
import com.trailmapper.shared.sijko.MapPointLabelSijko
import com.trailmapper.shared.sijko.MapPointSelectionResultMessageSijko
import com.trailmapper.shared.sijko.RouteEndpointTarget
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal class SavedDestinationEditorViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(SavedDestinationEditorUiState())
    val uiState: StateFlow<SavedDestinationEditorUiState> = _uiState

    private var autocompleteJob: Job? = null
    private var mapPointJob: Job? = null

    fun reset() {
        autocompleteJob?.cancel()
        mapPointJob?.cancel()
        _uiState.value = SavedDestinationEditorUiState()
    }

    fun updateName(name: String) {
        _uiState.update { it.copy(name = name) }
    }

    fun updateAddress(
        address: String,
        autocompleteProvider: AddressAutocompleteProvider,
    ) {
        _uiState.update {
            it.copy(
                address = address,
                point = null,
                autocompleteSuggestions = emptyList(),
                autocompleteError = null,
            )
        }
        requestAutocompletePredictions(
            query = address,
            provider = autocompleteProvider,
        )
    }

    fun requestMapPoint(provider: MapPointSelectionProvider) {
        autocompleteJob?.cancel()
        mapPointJob?.cancel()
        mapPointJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isChoosingMapPoint = true,
                    mapPointError = null,
                    autocompleteSuggestions = emptyList(),
                    autocompleteError = null,
                )
            }
            try {
                val result = provider.pickMapPoint(RouteEndpointTarget.Destination)
                _uiState.update { state ->
                    when (result) {
                        is MapPointSelectionResult.Success -> state.copy(
                            address = result.address?.takeIf { it.isNotBlank() }
                                ?: MapPointLabelSijko.labelFor(result.point),
                            point = result.point,
                            isChoosingMapPoint = false,
                            mapPointError = null,
                        )

                        MapPointSelectionResult.Cancelled,
                        MapPointSelectionResult.Unavailable,
                        is MapPointSelectionResult.Error,
                        -> state.copy(
                            isChoosingMapPoint = false,
                            mapPointError = MapPointSelectionResultMessageSijko.messageFor(result),
                        )
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                _uiState.update {
                    it.copy(
                        isChoosingMapPoint = false,
                        mapPointError = exception.message ?: "Map point selection failed.",
                    )
                }
            }
        }
    }

    fun selectAutocompletePrediction(
        prediction: AddressAutocompletePrediction,
        provider: AddressAutocompleteProvider,
    ) {
        autocompleteJob?.cancel()
        autocompleteJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isResolvingAutocomplete = true,
                    autocompleteError = null,
                )
            }
            val result = provider.resolvePrediction(prediction, RouteEndpointTarget.Destination)
            _uiState.update { state ->
                when (result) {
                    is AddressAutocompleteSelectionResult.Success -> state.copy(
                        address = result.address,
                        point = result.point,
                        autocompleteSuggestions = emptyList(),
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
        }
    }

    private fun requestAutocompletePredictions(
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
                    isResolvingAutocomplete = true,
                    autocompleteError = null,
                )
            }
            try {
                val predictions = provider.predictions(query, RouteEndpointTarget.Destination)
                _uiState.update {
                    it.copy(
                        autocompleteSuggestions = predictions,
                        isResolvingAutocomplete = false,
                    )
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
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

private const val AUTOCOMPLETE_DEBOUNCE_MILLIS = 300L
