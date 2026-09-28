/**
 * Job: Browse sourced trail paths without inventing connections or treating proposals as open trails.
 *
 */
package com.trailmapper.android.map

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.Dash
import com.google.android.gms.maps.model.Gap
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.trailmapper.android.routing.AndroidTrailNetworkProvider
import com.trailmapper.shared.TrailNetworkLoadResult
import com.trailmapper.shared.routing.TrailFeatureStatus
import com.trailmapper.shared.routing.TrailNetworkFeature
import com.trailmapper.shared.routing.TrailNetworkRole
import com.trailmapper.shared.routing.TrailRouteAdvisoryCorridor
import com.trailmapper.shared.routing.TrailRouteAdvisorySijko
import com.trailmapper.shared.sijko.MapPickerDefaultsSijko
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class TrailNetworkOverviewActivity : ComponentActivity() {
    private val overviewModel by lazy {
        ViewModelProvider(this, TrailNetworkOverviewModelFactory(applicationContext))[TrailNetworkOverviewModel::class.java]
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    TrailNetworkOverviewScreen(
                        result = overviewModel.result,
                        advisoryCorridors = overviewModel.advisoryCorridors,
                        onRetry = overviewModel::reload,
                        onBack = ::finish,
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        overviewModel.refreshAdvisories()
    }
}

private class TrailNetworkOverviewModel(context: Context) : ViewModel() {
    private val appContext = context.applicationContext
    private var loadJob: Job? = null

    var result by mutableStateOf<TrailNetworkLoadResult?>(null)
        private set
    var advisoryCorridors by mutableStateOf(TrailRouteAdvisorySijko.approximateCorridors())
        private set

    init {
        reload()
    }

    fun reload() {
        if (loadJob?.isActive == true) return
        result = null
        loadJob = viewModelScope.launch {
            // A new provider lets Retry attempt a fresh read even after a cached load error.
            result = AndroidTrailNetworkProvider(appContext).loadTrailNetwork()
        }
    }

    fun refreshAdvisories() {
        advisoryCorridors = TrailRouteAdvisorySijko.approximateCorridors()
    }
}

private class TrailNetworkOverviewModelFactory(private val context: Context) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass == TrailNetworkOverviewModel::class.java)
        @Suppress("UNCHECKED_CAST")
        return TrailNetworkOverviewModel(context) as T
    }
}

@Composable
private fun TrailNetworkOverviewScreen(
    result: TrailNetworkLoadResult?,
    advisoryCorridors: List<TrailRouteAdvisoryCorridor>,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    var showProposed by rememberSaveable { mutableStateOf(false) }
    var showAdvisories by rememberSaveable { mutableStateOf(true) }
    var layersExpanded by rememberSaveable { mutableStateOf(false) }
    var externalLinkError by rememberSaveable { mutableStateOf<String?>(null) }
    val uriHandler = LocalUriHandler.current
    val openLink: (String) -> Unit = { url ->
        try {
            uriHandler.openUri(url)
            externalLinkError = null
        } catch (_: Exception) {
            externalLinkError = "Unable to open this link. Check that a browser is available."
        }
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
        val controlsMaxHeight = maxHeight * 0.40f
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
                Text("Trail network", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = { openLink(CountyMapUrl) }) { Text("County map") }
            }
            externalLinkError?.let { message ->
                Text(message, modifier = Modifier.padding(horizontal = 12.dp), color = MaterialTheme.colorScheme.error)
            }
            when (result) {
                null -> Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                is TrailNetworkLoadResult.Success -> {
                    if (result.features.isEmpty()) {
                        NetworkLoadError("No trail paths are available.", onRetry, Modifier.weight(1f))
                    } else {
                        TrailNetworkMap(
                            features = result.features,
                            showProposed = showProposed,
                            showAdvisories = showAdvisories,
                            advisoryCorridors = advisoryCorridors,
                            openLink = openLink,
                            modifier = Modifier.weight(1f).fillMaxWidth(),
                        )
                    }
                }
                is TrailNetworkLoadResult.Error -> NetworkLoadError(result.message, onRetry, Modifier.weight(1f))
                TrailNetworkLoadResult.Unavailable ->
                    NetworkLoadError("Trail-network data is unavailable.", onRetry, Modifier.weight(1f))
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = controlsMaxHeight)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    NetworkLegend("County trails", TrailColor)
                    NetworkLegend("Park paths", ParkColor)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    NetworkLegend("Shared roads", SharedRoadColor)
                    NetworkLegend("Verified additions", SupplementColor)
                }
                TextButton(onClick = { layersExpanded = !layersExpanded }) {
                    Text(if (layersExpanded) "Hide map layers" else "Map layers")
                }
                if (showProposed) {
                    NetworkLegend("Dashed purple: proposed, not open infrastructure", ProposedColor)
                }
                if (layersExpanded) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Proposed preview · not usable", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        Switch(checked = showProposed, onCheckedChange = { showProposed = it })
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Reported closure areas", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        Switch(checked = showAdvisories, onCheckedChange = { showAdvisories = it })
                    }
                }
                if (showAdvisories) {
                    Text(
                        "Orange: approximate work corridor; route not automatically adjusted. Tap it for the official map.",
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
                Text("Bundled trail paths and reviewed notices; not live closure tracking.", style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = { openLink("https://www.openstreetmap.org/copyright") }) {
                Text("Trail data: McLean County GIS · © OpenStreetMap contributors", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun TrailNetworkMap(
    features: List<TrailNetworkFeature>,
    showProposed: Boolean,
    showAdvisories: Boolean,
    advisoryCorridors: List<TrailRouteAdvisoryCorridor>,
    openLink: (String) -> Unit,
    modifier: Modifier,
) {
    val visibleFeatures = remember(features, showProposed) {
        features.filter { showProposed || !it.isProposed() }
    }
    val paths = remember(visibleFeatures) {
        visibleFeatures.flatMap { feature ->
            feature.paths.mapIndexedNotNull { index, path ->
                if (path.size < 2) null else NetworkPath(
                    id = "${feature.id}:$index",
                    points = path.map { LatLng(it.latitude, it.longitude) },
                    color = feature.mapColor(),
                    proposed = feature.isProposed(),
                )
            }
        }
    }
    val camera = rememberCameraPositionState {
        val center = MapPickerDefaultsSijko.defaultPoint()
        position = CameraPosition.fromLatLngZoom(LatLng(center.latitude, center.longitude), 12f)
    }
    val scope = rememberCoroutineScope()
    var mapLoaded by remember { mutableStateOf(false) }
    Box(modifier) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = camera,
            uiSettings = MapUiSettings(mapToolbarEnabled = false),
            onMapLoaded = { mapLoaded = true },
        ) {
            paths.forEach { path ->
                key(path.id) {
                    Polyline(
                        points = path.points,
                        color = path.color,
                        width = if (path.proposed) 6f else 8f,
                        pattern = if (path.proposed) listOf(Dash(20f), Gap(12f)) else null,
                        zIndex = if (path.proposed) 1f else 2f,
                    )
                }
            }
            if (showAdvisories) {
                advisoryCorridors.forEach { corridor ->
                    key(corridor.advisoryId) {
                        Polyline(
                            points = corridor.points.map { LatLng(it.latitude, it.longitude) },
                            color = AdvisoryColor,
                            width = 9f,
                            zIndex = 3f,
                            clickable = true,
                            onClick = { openLink(corridor.sourceUrl) },
                        )
                    }
                }
            }
        }
        Surface(modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)) {
            TextButton(
                enabled = mapLoaded && paths.isNotEmpty(),
                onClick = {
                    val bounds = LatLngBounds.builder()
                    paths.forEach { path -> path.points.forEach(bounds::include) }
                    scope.launch { camera.animate(CameraUpdateFactory.newLatLngBounds(bounds.build(), 48)) }
                },
            ) { Text("Show all trails") }
        }
    }
}

@Composable
private fun NetworkLoadError(message: String, onRetry: () -> Unit, modifier: Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message)
        Button(onClick = onRetry, modifier = Modifier.padding(top = 12.dp)) { Text("Retry") }
    }
}

@Composable
private fun NetworkLegend(label: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(modifier = Modifier.size(9.dp).background(color, CircleShape))
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

private data class NetworkPath(
    val id: String,
    val points: List<LatLng>,
    val color: Color,
    val proposed: Boolean,
)

private fun TrailNetworkFeature.isProposed(): Boolean =
    status == TrailFeatureStatus.Proposed || TrailNetworkRole.ProposedTrails in routeRoles

private fun TrailNetworkFeature.mapColor(): Color = when {
    isProposed() -> ProposedColor
    id.startsWith("verified-osm:way:") -> SupplementColor
    TrailNetworkRole.SharedRoadways in routeRoles -> SharedRoadColor
    TrailNetworkRole.ParkConnectors in routeRoles -> ParkColor
    else -> TrailColor
}

private val TrailColor = Color(0xFF237A36)
private val ParkColor = Color(0xFF007F84)
private val SharedRoadColor = Color(0xFF355CB8)
private val SupplementColor = Color(0xFFB01767)
private val ProposedColor = Color(0xFF7851A9)
private val AdvisoryColor = Color(0xFFE3690B)
private const val CountyMapUrl =
    "https://mcleangis.maps.arcgis.com/apps/instant/sidebar/index.html?appid=d98c151296fd4b03860af8f4df7787a4"
