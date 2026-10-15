/**
 * Job: Display a real Google Maps picker screen and return the selected coordinate/address to the caller.
 *
 */
package com.trailmapper.android.map

import com.trailmapper.android.trailMapperLayoutDiagnostic
import com.trailmapper.android.TrailMapperAndroidTheme

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.content.res.Configuration
import android.text.Editable
import android.text.TextWatcher
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.graphics.toArgb
import androidx.compose.runtime.rememberUpdatedState
import androidx.activity.compose.BackHandler
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.KeyboardHide
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberUpdatedMarkerState
import com.trailmapper.android.location.AndroidAddressAutocompleteProvider
import com.trailmapper.shared.AddressAutocompletePrediction
import com.trailmapper.shared.AddressAutocompleteProvider
import com.trailmapper.shared.AddressAutocompleteSelectionResult
import com.trailmapper.shared.sijko.AddressAutocompleteQuerySijko
import com.trailmapper.shared.sijko.MapPickerDefaultsSijko
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.MapPointLabelSijko
import com.trailmapper.shared.sijko.RouteEndpointTarget
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.Saver
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.material3.TextButton
import androidx.compose.runtime.saveable.rememberSaveable

class MapPointPickerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val targetLabel = intent.getStringExtra(EXTRA_TARGET_LABEL) ?: "Location"
        val defaultPoint = MapPickerDefaultsSijko.defaultPoint()
        val addressResolver = AndroidMapPointAddressResolver(this)
        val addressAutocompleteProvider = AndroidAddressAutocompleteProvider(applicationContext)

        setContent {
            TrailMapperAndroidTheme(this@MapPointPickerActivity) {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .safeDrawingPadding(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    MapPointPickerScreen(
                        targetLabel = targetLabel,
                        defaultPoint = defaultPoint,
                        resolveAddress = addressResolver::resolvedAddressFor,
                        addressAutocompleteProvider = addressAutocompleteProvider,
                        onCancel = {
                            setResult(Activity.RESULT_CANCELED)
                            finish()
                        },
                        onPointConfirmed = { point, address ->
                            setResult(
                                Activity.RESULT_OK,
                                Intent()
                                    .putExtra(EXTRA_LATITUDE, point.latitude)
                                    .putExtra(EXTRA_LONGITUDE, point.longitude)
                                    .putExtra(EXTRA_ADDRESS, address),
                            )
                            finish()
                        },
                    )
                }
            }
        }
    }

    companion object {
        const val EXTRA_LATITUDE = "com.trailmapper.android.map.EXTRA_LATITUDE"
        const val EXTRA_LONGITUDE = "com.trailmapper.android.map.EXTRA_LONGITUDE"
        const val EXTRA_ADDRESS = "com.trailmapper.android.map.EXTRA_ADDRESS"
        private const val EXTRA_TARGET_LABEL = "com.trailmapper.android.map.EXTRA_TARGET_LABEL"

        fun createIntent(context: Context, targetLabel: String): Intent {
            return Intent(context, MapPointPickerActivity::class.java)
                .putExtra(EXTRA_TARGET_LABEL, targetLabel)
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun MapPointPickerScreen(
    targetLabel: String,
    defaultPoint: MapPoint,
    resolveAddress: suspend (MapPoint) -> String?,
    addressAutocompleteProvider: AddressAutocompleteProvider,
    onCancel: () -> Unit,
    onPointConfirmed: (MapPoint, String?) -> Unit,
) {
    var selectedPoint by rememberSaveable(targetLabel, stateSaver = MapPointStateSaver) { mutableStateOf(defaultPoint) }
    var addressPreviewPoint by rememberSaveable(targetLabel, stateSaver = NullableMapPointStateSaver) { mutableStateOf<MapPoint?>(null) }
    var selectedAddress by rememberSaveable(targetLabel) { mutableStateOf<String?>(null) }
    var isResolvingPreviewAddress by remember { mutableStateOf(false) }
    var isResolvingAddress by remember { mutableStateOf(false) }
    var searchText by rememberSaveable(targetLabel) { mutableStateOf("") }
    var isSearchFocused by remember { mutableStateOf(false) }
    var autocompleteSuggestions by remember { mutableStateOf(emptyList<AddressAutocompletePrediction>()) }
    var isResolvingAutocomplete by remember { mutableStateOf(false) }
    var isSelectingAutocomplete by remember { mutableStateOf(false) }
    var autocompleteError by remember { mutableStateOf<String?>(null) }
    val autocompleteTarget = remember(targetLabel) { targetForLabel(targetLabel) }
    val selectedLatLng = selectedPoint.toLatLng()
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(selectedLatLng, DEFAULT_ZOOM)
    }
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val rootView = LocalView.current
    fun hideSearchKeyboard() {
        keyboardController?.hide()
        (rootView.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(rootView.windowToken, 0)
    }
    BackHandler(enabled = isSearchFocused) {
        focusManager.clearFocus(); rootView.clearFocus()
        hideSearchKeyboard()
    }

    LaunchedEffect(cameraPositionState, isSelectingAutocomplete) {
        if (isSelectingAutocomplete) {
            return@LaunchedEffect
        }
        snapshotFlow { cameraPositionState.position.target }
            .collect { target ->
                selectedPoint = target.toMapPoint()
            }
    }

    LaunchedEffect(
        searchText,
        isSearchFocused,
        autocompleteTarget,
        addressAutocompleteProvider,
    ) {
        val query = searchText.trim()
        autocompleteError = null
        if (!isSearchFocused || !AddressAutocompleteQuerySijko.shouldSearch(query)) {
            autocompleteSuggestions = emptyList()
            isResolvingAutocomplete = false
            return@LaunchedEffect
        }
        if (!addressAutocompleteProvider.isAvailable) {
            autocompleteSuggestions = emptyList()
            isResolvingAutocomplete = false
            autocompleteError = "Address search is unavailable."
            return@LaunchedEffect
        }

        isResolvingAutocomplete = true
        delay(AUTOCOMPLETE_DEBOUNCE_MILLIS)
        try {
            autocompleteSuggestions = addressAutocompleteProvider.predictions(
                query = query,
                target = autocompleteTarget,
            )
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            autocompleteSuggestions = emptyList()
            autocompleteError = exception.message ?: "Address suggestions are unavailable."
        } finally {
            isResolvingAutocomplete = false
        }
    }

    LaunchedEffect(selectedPoint) {
        val point = selectedPoint
        if (pickerAddressMatchesSelection(addressPreviewPoint, point, selectedAddress)) {
            isResolvingPreviewAddress = false
            return@LaunchedEffect
        }
        addressPreviewPoint = null
        selectedAddress = null
        isResolvingPreviewAddress = true
        delay(ADDRESS_PREVIEW_DEBOUNCE_MILLIS)
        selectedAddress = resolveAddress(point)
        addressPreviewPoint = point
        isResolvingPreviewAddress = false
    }

    BoxWithConstraints(Modifier.fillMaxSize().imePadding().trailMapperLayoutDiagnostic("picker-content-after-ime")) {
        val availableHeight = maxHeight
        Column(modifier = Modifier.fillMaxSize()) {
            MapPointAutocompleteSearch(
                targetLabel = targetLabel,
                searchText = searchText,
                isFocused = isSearchFocused,
                isResolving = isResolvingAutocomplete,
                isSelecting = isSelectingAutocomplete,
                suggestions = autocompleteSuggestions,
                error = autocompleteError,
                onSearchTextChange = {
                    searchText = it
                    autocompleteError = null
                },
                onFocusChanged = { isSearchFocused = it },
                onDismissSearch = { focusManager.clearFocus(); rootView.clearFocus(); hideSearchKeyboard() },
                onHideKeyboard = { hideSearchKeyboard() },
                onClearSearch = {
                    searchText = ""
                    autocompleteSuggestions = emptyList()
                    autocompleteError = null
                },
                onSuggestionSelected = { suggestion ->
                    focusManager.clearFocus(); rootView.clearFocus()
                    hideSearchKeyboard()
                    autocompleteSuggestions = emptyList()
                    autocompleteError = null
                    isSelectingAutocomplete = true
                    scope.launch {
                        try {
                            when (
                                val result = addressAutocompleteProvider.resolvePrediction(
                                    prediction = suggestion,
                                    target = autocompleteTarget,
                                )
                            ) {
                                is AddressAutocompleteSelectionResult.Success -> {
                                    searchText = result.address
                                    selectedPoint = result.point
                                    addressPreviewPoint = result.point
                                    selectedAddress = result.address
                                    cameraPositionState.animate(
                                        CameraUpdateFactory.newLatLngZoom(
                                            result.point.toLatLng(),
                                            SEARCH_RESULT_ZOOM,
                                        ),
                                    )
                                    selectedPoint = result.point
                                    addressPreviewPoint = result.point
                                    selectedAddress = result.address
                                }

                                is AddressAutocompleteSelectionResult.Error -> {
                                    autocompleteError = result.message
                                }

                                AddressAutocompleteSelectionResult.Unavailable -> {
                                    autocompleteError = "Address search is unavailable."
                                }
                            }
                        } catch (exception: CancellationException) {
                            throw exception
                        } catch (exception: Exception) {
                            autocompleteError = exception.message ?: "The selected place could not be resolved."
                        } finally {
                            isSelectingAutocomplete = false
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .trailMapperLayoutDiagnostic("picker-search-panel")
                    .then(if (isSearchFocused) Modifier.weight(1f) else Modifier.heightIn(max = availableHeight * 0.5f))
                    .padding(if (isSearchFocused) 2.dp else 12.dp),
            )
            // Keep the map mounted while search uses the available keyboard viewport.
            Box(modifier = if (isSearchFocused) Modifier.height(0.dp) else Modifier.weight(1f)) {
                GoogleMap(
                    mapColorScheme = trailMapperMapColorScheme(isSystemInDarkTheme()),
                    modifier = Modifier.fillMaxSize(),
                    cameraPositionState = cameraPositionState,
                    onMapClick = { latLng ->
                        focusManager.clearFocus(); rootView.clearFocus()
                        hideSearchKeyboard()
                        autocompleteSuggestions = emptyList()
                        autocompleteError = null
                        selectedPoint = latLng.toMapPoint()
                        cameraPositionState.move(CameraUpdateFactory.newLatLng(latLng))
                    },
                ) {
                    Marker(
                        state = rememberUpdatedMarkerState(position = selectedLatLng),
                        title = targetLabel,
                    )
                }
            }

            if (!isSearchFocused) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = availableHeight * 0.4f)
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                        Text(
                            text = when {
                                isResolvingPreviewAddress -> "Finding address..."
                                selectedAddress != null -> selectedAddress.orEmpty()
                                else -> "Address unavailable"
                            },
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Text(
                            text = MapPointLabelSijko.coordinateTextFor(selectedPoint),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(
                            onClick = onCancel,
                            modifier = Modifier.weight(1f),
                            enabled = !isResolvingAddress,
                        ) {
                            Text("Cancel")
                        }
                        Button(
                            onClick = {
                                val point = selectedPoint
                                val address = selectedAddress.takeIf { addressPreviewPoint == point }
                                isResolvingAddress = true
                                scope.launch {
                                    onPointConfirmed(
                                        point,
                                        address ?: resolveAddress(point),
                                    )
                                }
                            },
                            modifier = Modifier.weight(1f),
                            enabled = !isResolvingAddress,
                        ) {
                            if (isResolvingAddress) {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp))
                            } else {
                                Text("Set point")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MapPointAutocompleteSearch(
    targetLabel: String,
    searchText: String,
    isFocused: Boolean,
    isResolving: Boolean,
    isSelecting: Boolean,
    suggestions: List<AddressAutocompletePrediction>,
    error: String?,
    onSearchTextChange: (String) -> Unit,
    onFocusChanged: (Boolean) -> Unit,
    onDismissSearch: () -> Unit,
    onHideKeyboard: () -> Unit,
    onClearSearch: () -> Unit,
    onSuggestionSelected: (AddressAutocompletePrediction) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        tonalElevation = 4.dp,
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val configuration = LocalConfiguration.current
            if (configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
                PickerExtractQueryEditor(targetLabel, searchText, onSearchTextChange, onFocusChanged, onHideKeyboard)
                if (isFocused) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = onHideKeyboard) { Text("Review suggestions") }
                        TextButton(onClick = onDismissSearch) { Text("Back to map") }
                        if (searchText.isNotBlank()) TextButton(onClick = onClearSearch) { Text("Clear") }
                    }
                }
            } else {
            OutlinedTextField(
                value = searchText,
                onValueChange = onSearchTextChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .onFocusChanged { onFocusChanged(it.isFocused) }
                    .trailMapperLayoutDiagnostic("picker-field"),
                label = { Text("Search $targetLabel") },
                placeholder = { Text("Address or place") },
                leadingIcon = {
                    if (isFocused) {
                        IconButton(onClick = onDismissSearch) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to map")
                        }
                    } else {
                        Icon(Icons.Filled.Search, contentDescription = null)
                    }
                },
                trailingIcon = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (isFocused) {
                            IconButton(onClick = onHideKeyboard) {
                                Icon(Icons.Filled.KeyboardHide, contentDescription = "Hide keyboard to review full suggestions")
                            }
                        }
                        when {
                            isResolving || isSelecting -> {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp))
                            }

                            searchText.isNotBlank() -> {
                                IconButton(onClick = onClearSearch) {
                                    Icon(
                                        imageVector = Icons.Filled.Close,
                                        contentDescription = "Clear map search",
                                    )
                                }
                            }
                        }
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onDismissSearch() }),
            )

            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
            MapPointAutocompleteResults(
                suggestions = suggestions,
                isResolving = isResolving,
                isSelecting = isSelecting,
                error = error,
                onSuggestionSelected = onSuggestionSelected,
            )
            }
        }
    }
}

@Composable
private fun MapPointAutocompleteResults(
    suggestions: List<AddressAutocompletePrediction>,
    isResolving: Boolean,
    isSelecting: Boolean,
    error: String?,
    onSuggestionSelected: (AddressAutocompletePrediction) -> Unit,
) {
    if (!isResolving && !isSelecting && suggestions.isEmpty() && error == null) {
        return
    }

    Column(
        modifier = Modifier
            .fillMaxWidth(),
    ) {
        if (isResolving || isSelecting) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp))
                Text(
                    text = if (isSelecting) "Moving map..." else "Finding places...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        suggestions.forEach { suggestion ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clickable { onSuggestionSelected(suggestion) }
                    .padding(horizontal = 8.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = suggestion.primaryText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                if (suggestion.secondaryText.isNotBlank()) {
                    Text(
                        text = suggestion.secondaryText,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        error?.let { message ->
            Text(
                text = message,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        if (isResolving || suggestions.isNotEmpty()) {
            Text(
                text = "Powered by Google",
                modifier = Modifier
                    .align(Alignment.End)
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun targetForLabel(label: String): RouteEndpointTarget {
    return enumValues<RouteEndpointTarget>()
        .firstOrNull { it.label == label }
        ?: RouteEndpointTarget.Destination
}

private fun MapPoint.toLatLng(): LatLng {
    return LatLng(latitude, longitude)
}

private fun LatLng.toMapPoint(): MapPoint {
    return MapPoint(latitude = latitude, longitude = longitude)
}

private const val DEFAULT_ZOOM = 13f
private const val SEARCH_RESULT_ZOOM = 16f
private const val AUTOCOMPLETE_DEBOUNCE_MILLIS = 300L
private const val ADDRESS_PREVIEW_DEBOUNCE_MILLIS = 600L


internal val MapPointStateSaver = listSaver<MapPoint, Double>(
    save = { listOf(it.latitude, it.longitude) },
    restore = { MapPoint(latitude = it[0], longitude = it[1]) },
)


internal val NullableMapPointStateSaver = Saver<MapPoint?, List<Double>>(
    save = { it?.let { point -> listOf(point.latitude, point.longitude) } ?: emptyList() },
    restore = { if (it.isEmpty()) null else MapPoint(latitude = it[0], longitude = it[1]) },
)

internal fun pickerAddressMatchesSelection(previewPoint: MapPoint?, selectedPoint: MapPoint, address: String?): Boolean =
    previewPoint == selectedPoint && address != null

internal fun pickerQueryImeOptions(): Int = EditorInfo.IME_ACTION_DONE

/** Permit the IME's fullscreen query editor when its landscape viewport cannot fit scaled app text. */
@Composable
private fun PickerExtractQueryEditor(
    targetLabel: String,
    query: String,
    onQueryChange: (String) -> Unit,
    onFocusChanged: (Boolean) -> Unit,
    onDone: () -> Unit,
) {
    val queryChanged by rememberUpdatedState(onQueryChange)
    val focusChanged by rememberUpdatedState(onFocusChanged)
    val done by rememberUpdatedState(onDone)
    val foreground = MaterialTheme.colorScheme.onSurface.toArgb()
    val hintColor = MaterialTheme.colorScheme.onSurfaceVariant.toArgb()
    AndroidView(
        modifier = Modifier.fillMaxWidth().trailMapperLayoutDiagnostic("picker-native-extract-field"),
        factory = { context ->
            EditText(context).apply {
                isSaveEnabled = false // Compose owns the saved query; avoid duplicate native state.
                setSingleLine(true)
                textSize = 16f // sp: retain the user's font scaling.
                hint = "Search $targetLabel"
                setTextColor(foreground)
                setHintTextColor(hintColor)
                // Do not suppress fullscreen extraction; a 93px app viewport cannot fit font2 text.
                imeOptions = pickerQueryImeOptions()
                setOnFocusChangeListener { _, focused -> focusChanged(focused) }
                addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
                    override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) {
                        queryChanged(text?.toString().orEmpty())
                    }
                    override fun afterTextChanged(text: Editable?) = Unit
                })
                setOnEditorActionListener { view, action, _ ->
                    if (action == EditorInfo.IME_ACTION_DONE) {
                        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                            .hideSoftInputFromWindow(view.windowToken, 0)
                        // Review predictions after extracted editing; Back to map dismisses explicitly.
                        done()
                        true
                    } else false
                }
            }
        },
        update = { view ->
            view.setTextColor(foreground)
            view.setHintTextColor(hintColor)
            if (view.text.toString() != query) {
                view.setText(query)
                view.setSelection(query.length)
            }
        },
    )
}
