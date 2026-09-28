/**
 * Job: Render a computed trail route visually on Android Google Maps.
 *
 */
package com.trailmapper.android.map

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Looper
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.MapsInitializer
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.maps.model.BitmapDescriptor
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.Dash
import com.google.android.gms.maps.model.Gap
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.StrokeStyle
import com.google.android.gms.maps.model.StyleSpan
import com.google.android.gms.maps.model.TextureStyle
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberUpdatedMarkerState
import com.trailmapper.shared.sijko.ForegroundLocationGrantSijko
import com.trailmapper.android.AndroidCompletedExerciseSessionStore
import com.trailmapper.shared.CarriedExerciseRide
import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.TrailMapperPersistenceJsonSijko
import com.trailmapper.shared.CompletedExerciseSessionFactorySijko
import com.trailmapper.shared.CompletedExerciseSessionStore
import com.trailmapper.shared.TrailRouteAdvisoryBanner
import com.trailmapper.shared.routing.ExerciseRouteCompletionSijko
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteAdvisorySijko
import com.trailmapper.shared.routing.TrailRouteInstruction
import com.trailmapper.shared.routing.TrailRouteInstructionDistanceSijko
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.routing.TrailRouteMapCuesSijko
import com.trailmapper.shared.routing.TrailRouteReverseSijko
import com.trailmapper.shared.routing.TrailRouteRiddenProgress
import com.trailmapper.shared.routing.TrailRouteRiddenProgressSijko
import com.trailmapper.shared.routing.TrailRouteNavigationSnapshot
import com.trailmapper.shared.routing.TrailRouteNavigationSnapshotSijko
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.routing.TrailRouteSegmentType
import com.trailmapper.shared.routing.TrailRouteSummarySijko
import com.trailmapper.shared.routing.TrailRouteTurnInstructionSijko
import com.trailmapper.shared.sijko.MapPickerDefaultsSijko
import com.trailmapper.shared.sijko.MapPoint
import kotlinx.coroutines.CancellationException
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import com.trailmapper.android.routing.AndroidSavedDestinationStore
import com.trailmapper.android.routing.AndroidSavedTrailRouteStore
import com.trailmapper.android.routing.AndroidTrailRouteShareProvider
import com.trailmapper.shared.SavedDestinationStore
import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.SavedTrailRouteStore
import com.trailmapper.shared.TrailRoutePreviewDestination
import com.trailmapper.shared.TrailRoutePreviewRequest
import com.trailmapper.shared.RecentTrailRouteHistorySijko
import com.trailmapper.shared.TrailRouteRecalculationSijko
import com.trailmapper.shared.routing.TrailRouteClosureGateSijko
import com.trailmapper.shared.routing.TrailRouteRecalculationOutcome
import com.trailmapper.shared.RecentTrailRouteStore
import com.trailmapper.shared.TrailRoutePreviewSaveController
import com.trailmapper.android.routing.AndroidRecentTrailRouteStore
import com.trailmapper.shared.TrailRoutePreviewSaveOutcome
import com.trailmapper.shared.TrailRouteShareProvider
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import com.trailmapper.shared.routing.TrailRouteRerouteSijko
import com.trailmapper.shared.routing.TrailRouteLoopRerouteSijko
import com.trailmapper.shared.routing.TrailRouteRerouteSearch
import com.trailmapper.shared.routing.TrailRouteRerouteAccess
import com.trailmapper.shared.routing.TrailRouteRerouteOutcome
import com.trailmapper.shared.routing.TrailRouteRerouteAttempt
import com.trailmapper.shared.routing.TrailRouteNavigationFix
import com.trailmapper.shared.routing.TrailRouteDeviationStatus
import com.trailmapper.shared.routing.TrailRouteDeviationState
import com.trailmapper.shared.routing.TrailRouteDeviationSijko
import com.trailmapper.shared.routing.TrailNetworkFeature
import com.trailmapper.shared.routing.AccessGraphBuilderSijko
import com.trailmapper.shared.TrailNetworkLoadResult
import com.trailmapper.android.routing.AndroidTrailNetworkProvider
import com.trailmapper.android.routing.AndroidAccessNetworkProvider
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import android.location.Location

class TrailRouteMapActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val route = TrailRouteMapJsonSijko.decode(intent.getStringExtra(EXTRA_ROUTE_JSON))
        val preview = previewRequestFrom(intent)
        val completedExerciseSessionStore = AndroidCompletedExerciseSessionStore(applicationContext)
        val savedTrailRouteStore = AndroidSavedTrailRouteStore(applicationContext)
        val savedDestinationStore = AndroidSavedDestinationStore(applicationContext)
        val trailRouteShareProvider = AndroidTrailRouteShareProvider(applicationContext)
        val recentTrailRouteStore = AndroidRecentTrailRouteStore(applicationContext)

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    if (route == null || route.segments.isEmpty()) {
                        TrailRouteMapUnavailableScreen(onBack = ::finish)
                    } else {
                        TrailRouteMapScreen(
                            plannedRoute = route,
                            completedExerciseSessionStore = completedExerciseSessionStore,
                            preview = preview,
                            savedTrailRouteStore = savedTrailRouteStore,
                            savedDestinationStore = savedDestinationStore,
                            trailRouteShareProvider = trailRouteShareProvider,
                            recentTrailRouteStore = recentTrailRouteStore,
                            onBack = ::finish,
                        )
                    }
                }
            }
        }
    }

    companion object {
        private const val EXTRA_ROUTE_JSON = "com.trailmapper.android.map.EXTRA_ROUTE_JSON"
        private const val EXTRA_TITLE = "com.trailmapper.android.map.EXTRA_TITLE"
        private const val EXTRA_DESTINATION_ADDRESS = "com.trailmapper.android.map.EXTRA_DESTINATION_ADDRESS"
        private const val EXTRA_DESTINATION_LATITUDE = "com.trailmapper.android.map.EXTRA_DESTINATION_LATITUDE"
        private const val EXTRA_DESTINATION_LONGITUDE = "com.trailmapper.android.map.EXTRA_DESTINATION_LONGITUDE"

        fun createIntent(
            context: Context,
            route: TrailRoute,
            preview: TrailRoutePreviewRequest = TrailRoutePreviewRequest(),
        ): Intent {
            val intent = Intent(context, TrailRouteMapActivity::class.java)
                .putExtra(EXTRA_ROUTE_JSON, TrailRouteMapJsonSijko.encode(route))
                .putExtra(EXTRA_TITLE, preview.title)
            preview.destination?.let { destination ->
                intent
                    .putExtra(EXTRA_DESTINATION_ADDRESS, destination.address)
                    .putExtra(EXTRA_DESTINATION_LATITUDE, destination.point.latitude)
                    .putExtra(EXTRA_DESTINATION_LONGITUDE, destination.point.longitude)
            }
            return intent
        }

        private fun previewRequestFrom(intent: Intent): TrailRoutePreviewRequest {
            val destination = if (
                intent.hasExtra(EXTRA_DESTINATION_LATITUDE) && intent.hasExtra(EXTRA_DESTINATION_LONGITUDE)
            ) {
                TrailRoutePreviewDestination(
                    address = intent.getStringExtra(EXTRA_DESTINATION_ADDRESS).orEmpty(),
                    point = MapPoint(
                        latitude = intent.getDoubleExtra(EXTRA_DESTINATION_LATITUDE, 0.0),
                        longitude = intent.getDoubleExtra(EXTRA_DESTINATION_LONGITUDE, 0.0),
                    ),
                )
            } else {
                null
            }
            return TrailRoutePreviewRequest(
                title = intent.getStringExtra(EXTRA_TITLE),
                destination = destination,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrailRouteMapScreen(
    plannedRoute: TrailRoute,
    completedExerciseSessionStore: CompletedExerciseSessionStore,
    preview: TrailRoutePreviewRequest,
    savedTrailRouteStore: SavedTrailRouteStore,
    savedDestinationStore: SavedDestinationStore,
    trailRouteShareProvider: TrailRouteShareProvider,
    recentTrailRouteStore: RecentTrailRouteStore,
    onBack: () -> Unit,
) {
    var reversedDirection by rememberSaveable(plannedRoute) { mutableStateOf(false) }
    // Saving happens here, after the rider has seen the whole route; nothing asked them to save first.
    var renameText by rememberSaveable(plannedRoute) { mutableStateOf<String?>(null) }
    val previewSnackbarHostState = remember { SnackbarHostState() }
    val previewScope = rememberCoroutineScope()
    val saveController = remember(plannedRoute) {
        TrailRoutePreviewSaveController(savedTrailRouteStore, savedDestinationStore, previewScope, recentTrailRouteStore)
    }
    val saveState by saveController.state.collectAsState()
    LaunchedEffect(saveController) {
        saveController.offerDestination(preview.destination)
    }
    // Opening a route's map puts it at the top of Recent, unless it is saved; Saved is its home then.
    LaunchedEffect(plannedRoute) {
        try {
            RecentTrailRouteHistorySijko.record(
                store = recentTrailRouteStore,
                savedStore = savedTrailRouteStore,
                route = plannedRoute,
                title = preview.title ?: RecentTrailRouteHistorySijko.titleFor(plannedRoute, preview.destination?.address),
                nowEpochMillis = System.currentTimeMillis(),
            )
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            Unit
        }
    }
    // A route recalculated around an active closure replaces the plan shown, and its saved or recent entry.
    var recalculatedPlanJson by rememberSaveable(plannedRoute) { mutableStateOf<String?>(null) }
    val activePlan = remember(plannedRoute, recalculatedPlanJson) {
        recalculatedPlanJson?.let(TrailRouteMapJsonSijko::decode) ?: plannedRoute
    }
    val directedRoute = remember(activePlan, reversedDirection) {
        if (reversedDirection) TrailRouteReverseSijko.reversed(activePlan) else activePlan
    }
    // A replacement adopted after a confirmed departure. The saved original is never changed.
    var replacementRouteJson by rememberSaveable(plannedRoute) { mutableStateOf<String?>(null) }
    // What was ridden of earlier routes before rejoining onto the replacement, so the workout is recorded whole.
    var carriedRideJson by rememberSaveable(plannedRoute) { mutableStateOf<String?>(null) }
    val carriedRide = carriedRideJson?.let(TrailMapperPersistenceJsonSijko::decodeCarriedExerciseRide)
        ?: CarriedExerciseRide()
    val route = remember(directedRoute, replacementRouteJson) {
        replacementRouteJson?.let(TrailRouteMapJsonSijko::decode) ?: directedRoute
    }
    // Save always acts on the route on screen, including a replacement kept after a reroute and Stop.
    LaunchedEffect(saveController, route) {
        saveController.show(route)
    }
    // The route a replacement superseded, drawn faintly so the rider can see what changed.
    var supersededRoute by remember(plannedRoute) { mutableStateOf<TrailRoute?>(null) }
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var advisoryNowEpochMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    var reviewedAdvisoryId by rememberSaveable(plannedRoute) { mutableStateOf<String?>(null) }
    val routeAdvisories = remember(route, advisoryNowEpochMillis) {
        TrailRouteAdvisorySijko.forRoute(route, advisoryNowEpochMillis)
    }
    // An active trail closure on the route keeps Start disabled until it is recalculated; there is no
    // "start anyway". New routes already avoid closures; this catches routes planned before one began.
    val blockingAdvisories = remember(route, advisoryNowEpochMillis) {
        TrailRouteClosureGateSijko.blockingAdvisories(route, advisoryNowEpochMillis)
    }
    var recalculatingAroundClosure by remember { mutableStateOf(false) }
    var closureNoRouteMessage by remember(route) { mutableStateOf<String?>(null) }
    val advisoryCorridors = remember(routeAdvisories, advisoryNowEpochMillis) {
        val ids = routeAdvisories.mapTo(mutableSetOf()) { it.id }
        TrailRouteAdvisorySijko.approximateCorridors(advisoryNowEpochMillis)
            .filter { it.advisoryId in ids }
    }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                advisoryNowEpochMillis = System.currentTimeMillis()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    val routePoints = remember(route) {
        route.segments.flatMap { it.points }
    }
    val mapCues = remember(route) {
        TrailRouteMapCuesSijko.cuesFor(route)
    }
    // Stamped chevrons need the latest map renderer. The legacy fallback, used for example while Play
    // services is still downloading the latest one, draws a stamped transparent line solid black.
    var directionStampsSupported by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        MapsInitializer.initialize(context.applicationContext, MapsInitializer.Renderer.LATEST) { renderer ->
            directionStampsSupported = renderer == MapsInitializer.Renderer.LATEST
        }
    }
    val routeInstructions = remember(route) {
        TrailRouteTurnInstructionSijko.instructionsFor(route)
    }
    val hasEstimatedAccess = remember(route) {
        route.segments.any { it.type == TrailRouteSegmentType.Access && !it.isRouted }
    }
    val hasRoutedAccess = remember(route) {
        route.segments.any { it.type == TrailRouteSegmentType.Access && it.isRouted }
    }
    val initialPoint = routePoints.firstOrNull() ?: MapPickerDefaultsSijko.defaultPoint()
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(initialPoint.toLatLng(), DEFAULT_ROUTE_ZOOM)
    }
    var mapLoaded by remember { mutableStateOf(false) }
    var activeNavigation by rememberSaveable(plannedRoute) { mutableStateOf(false) }
    var showDirectionsSheet by rememberSaveable(plannedRoute) { mutableStateOf(false) }
    var locationPermissionGranted by remember {
        mutableStateOf(context.hasForegroundLocationPermission())
    }
    var navigationMessage by remember { mutableStateOf<String?>(null) }
    var navigationMessageIsError by remember { mutableStateOf(false) }
    var maximumProgressMeters by rememberSaveable(plannedRoute) { mutableStateOf(0.0) }
    var verifiedProgressMeters by rememberSaveable(plannedRoute) { mutableStateOf(0.0) }
    var riddenMeters by rememberSaveable(plannedRoute) { mutableStateOf(0.0) }
    var pendingJumpMeters by rememberSaveable(plannedRoute) { mutableStateOf<Double?>(null) }
    var exerciseDeparted by rememberSaveable(plannedRoute) { mutableStateOf(false) }
    var exerciseCompleted by rememberSaveable(plannedRoute) { mutableStateOf(false) }
    var pendingCompletedSession by remember(plannedRoute) { mutableStateOf<CompletedExerciseSession?>(null) }
    val directionsSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        val granted = ForegroundLocationGrantSijko.isGranted(
            fineGranted = grants[Manifest.permission.ACCESS_FINE_LOCATION] == true,
            coarseGranted = grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true,
        )
        locationPermissionGranted = granted
        activeNavigation = granted
        navigationMessage = if (granted) {
            navigationMessageIsError = false
            null
        } else {
            navigationMessageIsError = true
            "Location permission is required for active navigation."
        }
    }
    val liveNavigationFix = rememberNavigationLocationFix(
        active = activeNavigation,
        permissionGranted = locationPermissionGranted,
    )
    val liveNavigationPoint = liveNavigationFix?.point
    val navigationPoint = liveNavigationPoint ?: routePoints.firstOrNull()
    var deviation by remember(route) { mutableStateOf(TrailRouteDeviationState()) }
    var lastRerouteAttempt by remember(route) { mutableStateOf<TrailRouteRerouteAttempt?>(null) }
    var rerouteSearch by remember { mutableStateOf(TrailRouteRerouteSearch()) }
    val rerouteInProgress = rerouteSearch.inProgress
    var rerouteRequestedByRider by remember { mutableStateOf(false) }
    var rerouteJob by remember { mutableStateOf<Job?>(null) }
    // A search finishes later; it must judge adoption against the state then, not when it started.
    val currentRoute by rememberUpdatedState(route)
    val currentDeviation by rememberUpdatedState(deviation)
    val navigationStillActive by rememberUpdatedState(activeNavigation)
    val coroutineScope = rememberCoroutineScope()
    val trailNetworkProvider = remember { AndroidTrailNetworkProvider(context.applicationContext) }
    val accessNetworkProvider = remember { AndroidAccessNetworkProvider(context.applicationContext) }
    var trailFeatures by remember { mutableStateOf<List<TrailNetworkFeature>?>(null) }

    fun recalculateAroundClosure() {
        if (recalculatingAroundClosure) return
        val staleRoute = route
        val previousPlanJson = recalculatedPlanJson
        val previousReversed = reversedDirection
        recalculatingAroundClosure = true
        closureNoRouteMessage = null
        coroutineScope.launch {
            try {
                val features = trailFeatures ?: when (val loaded = trailNetworkProvider.loadTrailNetwork()) {
                    is TrailNetworkLoadResult.Success -> loaded.features.also { trailFeatures = it }
                    else -> null
                }
                if (features == null) {
                    closureNoRouteMessage = "Trail data is unavailable, so the route cannot be recalculated."
                    return@launch
                }
                // As in a reroute: missing road data allows estimated access, but road data that failed to
                // load stops the search rather than quietly building the route under weaker rules.
                val access = TrailRouteRerouteSijko.accessFor(
                    accessNetworkProvider.loadAccessNetwork(TrailRouteClosureGateSijko.accessEndpoints(staleRoute)),
                )
                val sessions = if (staleRoute.kind == TrailRouteKind.ExerciseLoop) {
                    completedExerciseSessionStore.completedSessions()
                } else {
                    emptyList()
                }
                val now = System.currentTimeMillis()
                val outcome = withContext(Dispatchers.Default) {
                    TrailRouteClosureGateSijko.recalculate(
                        features = features,
                        route = staleRoute,
                        access = access,
                        completedSessions = sessions,
                        nowEpochMillis = now,
                        cancellationCheckpoint = { ensureActive() },
                    )
                }
                when (outcome) {
                    is TrailRouteRecalculationOutcome.Replacement -> {
                        val applied = TrailRouteRecalculationSijko.apply(
                            savedStore = savedTrailRouteStore,
                            recentStore = recentTrailRouteStore,
                            oldRoute = staleRoute,
                            newRoute = outcome.route,
                            title = preview.title
                                ?: RecentTrailRouteHistorySijko.titleFor(staleRoute, preview.destination?.address),
                            nowEpochMillis = now,
                        )
                        reversedDirection = false
                        replacementRouteJson = null
                        recalculatedPlanJson = TrailRouteMapJsonSijko.encode(outcome.route)
                        val result = previewSnackbarHostState.showSnackbar(
                            message = "Rerouted around the closure · " +
                                "%.1f mi".format(outcome.route.totalDistanceMeters / METERS_PER_MILE),
                            actionLabel = "Undo",
                            duration = SnackbarDuration.Long,
                        )
                        if (result == SnackbarResult.ActionPerformed) {
                            TrailRouteRecalculationSijko.undo(
                                savedStore = savedTrailRouteStore,
                                recentStore = recentTrailRouteStore,
                                applied = applied,
                                nowEpochMillis = System.currentTimeMillis(),
                            )
                            recalculatedPlanJson = previousPlanJson
                            reversedDirection = previousReversed
                        }
                    }
                    is TrailRouteRecalculationOutcome.NoSafeRoute -> {
                        closureNoRouteMessage = outcome.blockingClosures.firstOrNull()?.guidance
                            ?: "No route around the closure was found from this start."
                    }
                    TrailRouteRecalculationOutcome.RoadDataFailed -> {
                        closureNoRouteMessage = "Road data could not be loaded, so the route cannot be recalculated. Try again."
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                closureNoRouteMessage = "The route could not be recalculated. Try again."
            } finally {
                recalculatingAroundClosure = false
            }
        }
    }

    fun resetProgress() {
        maximumProgressMeters = 0.0
        verifiedProgressMeters = 0.0
        riddenMeters = 0.0
        pendingJumpMeters = null
        exerciseDeparted = false
        exerciseCompleted = false
    }

    fun cancelReroute() {
        rerouteJob?.cancel()
        rerouteJob = null
        rerouteSearch = rerouteSearch.cancelled()
    }

    // Point-to-point routes are replaced automatically; an exercise loop is only ever rejoined or
    // abandoned for the start at the rider's explicit choice.
    fun startReroute(fix: TrailRouteNavigationFix, kind: RerouteKind, requestedByRider: Boolean) {
        val isLoop = route.kind == TrailRouteKind.ExerciseLoop
        if (rerouteSearch.inProgress || isLoop != (kind != RerouteKind.PointToPoint)) {
            return
        }
        // A route must start from where the rider really is, not from a coarse or late fix.
        if (!TrailRouteDeviationSijko.isCredible(fix, System.currentTimeMillis())) {
            navigationMessage = "Waiting for an accurate GPS fix before calculating a new route."
            navigationMessageIsError = true
            return
        }
        val routeAtStart = route
        val progressAtStart = riddenMeters
        lastRerouteAttempt = TrailRouteRerouteAttempt(fix.point, fix.timeEpochMillis)
        rerouteRequestedByRider = requestedByRider
        rerouteSearch = rerouteSearch.started()
        val generation = rerouteSearch.generation
        rerouteJob = coroutineScope.launch {
            try {
                val features = trailFeatures ?: when (val loaded = trailNetworkProvider.loadTrailNetwork()) {
                    is TrailNetworkLoadResult.Success -> loaded.features.also { trailFeatures = it }
                    else -> null
                }
                if (features == null) {
                    navigationMessage = "Trail data is unavailable, so a new route cannot be calculated."
                    navigationMessageIsError = true
                    return@launch
                }
                val destination = TrailRouteRerouteSijko.destinationOf(routeAtStart) ?: return@launch
                val access = TrailRouteRerouteSijko.accessFor(
                    accessNetworkProvider.loadAccessNetwork(listOf(fix.point, destination)),
                )
                if (access == TrailRouteRerouteAccess.LoadFailed) {
                    navigationMessage = "Road data could not be loaded, so a new route cannot be calculated."
                    navigationMessageIsError = true
                    return@launch
                }
                val outcome = withContext(Dispatchers.Default) {
                    val accessGraph = (access as? TrailRouteRerouteAccess.Roads)?.let { roads ->
                        AccessGraphBuilderSijko.buildGraph(roads.features, cancellationCheckpoint = { ensureActive() })
                    }
                    when (kind) {
                        RerouteKind.PointToPoint -> TrailRouteRerouteSijko.pointToPoint(
                            features = features,
                            route = routeAtStart,
                            from = fix.point,
                            accessGraph = accessGraph,
                            cancellationCheckpoint = { ensureActive() },
                        )
                        RerouteKind.RejoinLoop -> TrailRouteLoopRerouteSijko.rejoin(
                            features = features,
                            route = routeAtStart,
                            from = fix.point,
                            progressMeters = progressAtStart,
                            accessGraph = accessGraph,
                            cancellationCheckpoint = { ensureActive() },
                        )
                        RerouteKind.ReturnToStart -> TrailRouteLoopRerouteSijko.returnToStart(
                            features = features,
                            route = routeAtStart,
                            from = fix.point,
                            accessGraph = accessGraph,
                            cancellationCheckpoint = { ensureActive() },
                        )
                    }
                }
                if (!rerouteSearch.isCurrent(generation) || !TrailRouteRerouteSijko.shouldAdopt(
                        requestedByRider = requestedByRider,
                        deviationNow = currentDeviation,
                        routeUnchanged = currentRoute === routeAtStart,
                        navigationActive = navigationStillActive,
                    )
                ) {
                    return@launch
                }
                when (outcome) {
                    is TrailRouteRerouteOutcome.Replacement -> {
                        val remainingBefore = routeAtStart.totalDistanceMeters - progressAtStart
                        supersededRoute = routeAtStart
                        replacementRouteJson = TrailRouteMapJsonSijko.encode(outcome.route)
                        if (kind == RerouteKind.RejoinLoop) {
                            carriedRideJson = TrailMapperPersistenceJsonSijko.encodeCarriedExerciseRide(
                                carriedRide.plusRiddenPart(routeAtStart, progressAtStart),
                            )
                        }
                        resetProgress()
                        val miles = formatNavigationMiles(outcome.route.totalDistanceMeters)
                        navigationMessage = when (kind) {
                            RerouteKind.PointToPoint -> "Route updated from here: $miles to your destination."
                            RerouteKind.RejoinLoop ->
                                "Rejoining the loop ahead: $miles to the finish " +
                                    "(${formatNavigationMiles(remainingBefore)} remained on the planned loop)."
                            RerouteKind.ReturnToStart -> "Heading back to the start: $miles."
                        }
                        navigationMessageIsError = false
                    }
                    is TrailRouteRerouteOutcome.NoSafeRoute -> {
                        navigationMessage = outcome.blockingClosures.firstOrNull()?.let { closure ->
                            "No safe route from here. ${closure.guidance}"
                        } ?: "No safe route from here. Head back toward the route line."
                        navigationMessageIsError = true
                    }
                }
            } catch (exception: CancellationException) {
                throw exception
            } catch (_: Exception) {
                navigationMessage = "A new route could not be calculated."
                navigationMessageIsError = true
            } finally {
                // A search cancelled and replaced by a newer one must not clear the newer one's progress.
                rerouteSearch = rerouteSearch.finished(generation)
            }
        }
    }
    val navigationSnapshot = remember(route, routeInstructions, navigationPoint, maximumProgressMeters) {
        navigationPoint?.let { point ->
            TrailRouteNavigationSnapshotSijko.snapshotFor(
                route = route,
                instructions = routeInstructions,
                userPoint = point,
                minimumProgressMeters = if (route.kind == TrailRouteKind.ExerciseLoop) {
                    maximumProgressMeters
                } else {
                    0.0
                },
                previousProgressMeters = maximumProgressMeters.takeIf { route.kind != TrailRouteKind.ExerciseLoop },
            )
        }
    }
    val mapProperties = remember(activeNavigation, locationPermissionGranted) {
        MapProperties(isMyLocationEnabled = activeNavigation && locationPermissionGranted)
    }
    val mapUiSettings = remember {
        MapUiSettings(
            compassEnabled = true,
            myLocationButtonEnabled = false,
            zoomControlsEnabled = false,
        )
    }

    LaunchedEffect(mapLoaded, routePoints, activeNavigation) {
        if (mapLoaded && routePoints.isNotEmpty() && !activeNavigation) {
            val latLngs = routePoints.map { it.toLatLng() }
            val bounds = latLngs.toBoundsOrNull()
            if (bounds == null) {
                cameraPositionState.animate(
                    CameraUpdateFactory.newLatLngZoom(latLngs.first(), DEFAULT_ROUTE_ZOOM),
                )
            } else {
                cameraPositionState.animate(
                    CameraUpdateFactory.newLatLngBounds(bounds, ROUTE_CAMERA_PADDING_PIXELS),
                )
            }
        }
    }

    LaunchedEffect(mapLoaded, activeNavigation, navigationSnapshot) {
        if (mapLoaded && activeNavigation && navigationSnapshot != null) {
            cameraPositionState.animate(
                CameraUpdateFactory.newCameraPosition(
                    CameraPosition.Builder()
                        .target(navigationSnapshot.cameraTarget.toLatLng())
                        .zoom(ACTIVE_NAVIGATION_ZOOM)
                        .tilt(ACTIVE_NAVIGATION_TILT)
                        .bearing(navigationSnapshot.bearingDegrees.toFloat())
                        .build(),
                ),
            )
        }
    }

    LaunchedEffect(activeNavigation, liveNavigationFix, navigationSnapshot) {
        val fix = liveNavigationFix
        if (!activeNavigation || fix == null || navigationSnapshot == null) {
            return@LaunchedEffect
        }
        deviation = TrailRouteDeviationSijko.next(
            previous = deviation,
            fix = fix,
            distanceFromRouteMeters = navigationSnapshot.distanceFromRouteMeters,
            nowEpochMillis = System.currentTimeMillis(),
        )
        val now = System.currentTimeMillis()
        if (rerouteInProgress && !rerouteRequestedByRider && deviation.status == TrailRouteDeviationStatus.OnRoute) {
            // The rider is back on the route: an automatic search is no longer wanted.
            cancelReroute()
        }
        if (route.kind != TrailRouteKind.ExerciseLoop &&
            TrailRouteRerouteSijko.shouldSearchAutomatically(deviation, fix, lastRerouteAttempt, rerouteInProgress, now)
        ) {
            startReroute(fix, RerouteKind.PointToPoint, requestedByRider = false)
        }
        val ridden = TrailRouteRiddenProgressSijko.next(
            previous = TrailRouteRiddenProgress(riddenMeters, pendingJumpMeters),
            snapshot = navigationSnapshot,
        )
        riddenMeters = ridden.riddenMeters
        pendingJumpMeters = ridden.pendingJumpMeters
        verifiedProgressMeters =ExerciseRouteCompletionSijko.verifiedProgressMeters(
            previousVerifiedMeters = verifiedProgressMeters,
            previousMaximumProgressMeters = maximumProgressMeters,
            snapshot = navigationSnapshot,
        )
        maximumProgressMeters = maxOf(
            maximumProgressMeters,
            navigationSnapshot.distanceAlongRouteMeters,
        )
        exerciseDeparted = ExerciseRouteCompletionSijko.hasDeparted(
            route = route,
            snapshot = navigationSnapshot,
            previouslyDeparted = exerciseDeparted,
        )
        if (!ExerciseRouteCompletionSijko.shouldComplete(
                route = route,
                snapshot = navigationSnapshot,
                hasDeparted = exerciseDeparted,
                alreadyCompleted = exerciseCompleted,
                verifiedProgressMeters = verifiedProgressMeters,
            )
        ) {
            return@LaunchedEffect
        }

        exerciseCompleted = true
        navigationMessage = "Exercise route complete."
        navigationMessageIsError = false
        pendingCompletedSession = CompletedExerciseSessionFactorySijko.create(
            route = route,
            completedAtEpochMillis = System.currentTimeMillis(),
            carriedRide = carriedRide,
        )
        if (pendingCompletedSession == null) {
            activeNavigation = false
        }
    }

    LaunchedEffect(pendingCompletedSession?.id) {
        val completedSession = pendingCompletedSession ?: return@LaunchedEffect
        try {
            completedExerciseSessionStore.recordCompletedSession(completedSession)
        } catch (exception: CancellationException) {
            throw exception
        } catch (_: Exception) {
            navigationMessage = "Exercise route complete, but its history could not be saved."
            navigationMessageIsError = true
        } finally {
            pendingCompletedSession = null
            activeNavigation = false
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = cameraPositionState,
            properties = mapProperties,
            uiSettings = mapUiSettings,
            onMapLoaded = { mapLoaded = true },
        ) {
            val singleChevron = remember(directionStampsSupported) {
                if (directionStampsSupported) {
                    BitmapDescriptorFactory.fromBitmap(TrailRouteTraversalCueIcons.directionStamp(doubled = false))
                } else {
                    null
                }
            }
            val doubleChevron = remember(directionStampsSupported) {
                if (directionStampsSupported) {
                    BitmapDescriptorFactory.fromBitmap(TrailRouteTraversalCueIcons.directionStamp(doubled = true))
                } else {
                    null
                }
            }
            mapCues.firstPass
                .filter { segment -> segment.points.size >= MINIMUM_DRAWABLE_SEGMENT_POINT_COUNT }
                .forEach { segment -> RouteSegmentPolylines(segment = segment, directionStamp = singleChevron) }
            // A second pass over the same trail is drawn beside the first, with double chevrons.
            mapCues.secondPass
                .filter { segment -> segment.points.size >= MINIMUM_DRAWABLE_SEGMENT_POINT_COUNT }
                .forEach { segment -> RouteSegmentPolylines(segment = segment, directionStamp = doubleChevron) }
            supersededRoute?.let { previous ->
                previous.segments.forEach { segment ->
                    Polyline(
                        points = segment.points.map(MapPoint::toLatLng),
                        color = SUPERSEDED_ROUTE_COLOR,
                        width = SUPERSEDED_ROUTE_WIDTH,
                        zIndex = SUPERSEDED_ROUTE_Z_INDEX,
                    )
                }
            }
            if (activeNavigation) {
                // Fade the part credibly ridden so the rest of the loop stands out.
                mapCues.riddenPolylines(riddenMeters).forEach { ridden ->
                    Polyline(
                        points = ridden.map(MapPoint::toLatLng),
                        color = RIDDEN_OVERLAY_COLOR,
                        width = RIDDEN_OVERLAY_WIDTH,
                        zIndex = RIDDEN_OVERLAY_Z_INDEX,
                    )
                }
            }
            val density = LocalDensity.current.density
            val turnaroundIcon = remember(density) {
                BitmapDescriptorFactory.fromBitmap(TrailRouteTraversalCueIcons.turnaroundMarker(density))
            }
            mapCues.turnarounds.forEach { turnaround ->
                Marker(
                    state = rememberUpdatedMarkerState(position = turnaround.point.toLatLng()),
                    title = "Turn around",
                    snippet = "${formatNavigationMiles(turnaround.distanceAlongRouteMeters)} into the route",
                    icon = turnaroundIcon,
                    anchor = Offset(0.5f, 0.5f),
                    zIndex = TURNAROUND_MARKER_Z_INDEX,
                )
            }
            advisoryCorridors.forEach { corridor ->
                Polyline(
                    points = corridor.points.map(MapPoint::toLatLng),
                    color = ADVISORY_CORRIDOR_COLOR,
                    width = 10f,
                    pattern = listOf(Dash(24f), Gap(16f)),
                    zIndex = 3f,
                    clickable = true,
                    onClick = { reviewedAdvisoryId = corridor.advisoryId },
                )
            }

            routePoints.firstOrNull()?.let { start ->
                Marker(
                    state = rememberUpdatedMarkerState(position = start.toLatLng()),
                    title = if (route.kind == TrailRouteKind.ExerciseLoop) "Start / Finish" else "Start",
                )
            }
            routePoints.lastOrNull()
                ?.takeIf { route.kind != TrailRouteKind.ExerciseLoop }
                ?.let { destination ->
                Marker(
                    state = rememberUpdatedMarkerState(position = destination.toLatLng()),
                    title = "Destination",
                )
            }
        }

        Surface(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .fillMaxWidth(),
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                        )
                    }
                    Text(
                        text = when {
                            activeNavigation && route.kind == TrailRouteKind.ExerciseLoop -> "Exercise navigation"
                            activeNavigation -> "Navigate"
                            route.kind == TrailRouteKind.ExerciseLoop -> "Exercise route"
                            else -> "Trail route"
                        },
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                routeAdvisories.forEach { advisory ->
                    TrailRouteAdvisoryBanner(
                        advisory = advisory,
                        onReview = { reviewedAdvisoryId = advisory.id },
                    )
                }
                if (mapCues.hasTraversalCues) {
                    Text(
                        text = if (directionStampsSupported) {
                            "Chevrons show direction. Double chevrons: second pass, drawn beside the first. " +
                                "Turn-around signs mark where the route turns back."
                        } else {
                            "A second pass is drawn beside the first. Turn-around signs mark where the route turns back."
                        },
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (advisoryCorridors.isNotEmpty()) {
                    Text(
                        text = "Orange dashed line: approximate work corridor, not exact closure limits.",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (activeNavigation) {
                    ActiveNavigationBanner(
                        snapshot = navigationSnapshot,
                        hasLiveLocation = liveNavigationPoint != null,
                        deviationStatus = deviation.status,
                        rerouteInProgress = rerouteInProgress,
                    )
                }
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 12.dp)
                .fillMaxWidth(),
        ) {
        SnackbarHost(hostState = previewSnackbarHostState)
        RouteMapBottomControls(
            route = route,
            routeInstructions = routeInstructions,
            isSaved = saveState.savedRoute != null,
            saveEnabled = saveState.canSaveRoute,
            onSave = {
                previewScope.launch {
                    when (val outcome = saveController.saveShownRoute()) {
                        is TrailRoutePreviewSaveOutcome.Done -> {
                            val message = if (outcome.alreadySaved) {
                                "Already saved as ${outcome.item.title}"
                            } else {
                                "Saved to Saved routes as ${outcome.item.title}"
                            }
                            val result = previewSnackbarHostState.showSnackbar(
                                message = message,
                                actionLabel = "Rename",
                                duration = SnackbarDuration.Long,
                            )
                            if (result == SnackbarResult.ActionPerformed) {
                                renameText = saveController.state.value.savedRoute?.title ?: outcome.item.title
                            }
                        }
                        TrailRoutePreviewSaveOutcome.Failed ->
                            previewSnackbarHostState.showSnackbar("Unable to save route.")
                        TrailRoutePreviewSaveOutcome.Ignored -> Unit
                    }
                }
            },
            onShare = {
                val saved = saveState.savedRoute
                trailRouteShareProvider.share(
                    SavedTrailRoute(
                        id = saved?.id ?: UNSAVED_SHARE_ID,
                        title = saved?.title
                            ?: if (route.kind == TrailRouteKind.ExerciseLoop) "Exercise route" else "Trail route",
                        summary = TrailRouteSummarySijko.summaryFor(route),
                        route = route,
                    ),
                )
            },
            onSaveDestination = if (saveState.destination != null && saveState.savedDestination == null) {
                {
                    previewScope.launch {
                        when (val outcome = saveController.saveDestination()) {
                            is TrailRoutePreviewSaveOutcome.Done -> previewSnackbarHostState.showSnackbar(
                                if (outcome.alreadySaved) {
                                    "${outcome.item.title} is already in your places"
                                } else {
                                    "Saved ${outcome.item.title} to your places"
                                },
                            )
                            TrailRoutePreviewSaveOutcome.Failed ->
                                previewSnackbarHostState.showSnackbar("Unable to save destination.")
                            TrailRoutePreviewSaveOutcome.Ignored -> Unit
                        }
                    }
                }
            } else {
                null
            },
            saveDestinationEnabled = saveState.canSaveDestination,
            activeNavigation = activeNavigation,
            navigationSnapshot = navigationSnapshot,
            navigationMessage = navigationMessage,
            navigationMessageIsError = navigationMessageIsError,
            deviationStatus = deviation.status,
            rerouteInProgress = rerouteInProgress,
            onRecalculate = liveNavigationFix
                ?.takeIf { route.kind != TrailRouteKind.ExerciseLoop }
                ?.let { fix -> { startReroute(fix, RerouteKind.PointToPoint, requestedByRider = true) } },
            // A loop rider off route chooses: rejoin the remaining loop ahead, or head back to the start.
            onLoopChoice = liveNavigationFix
                ?.takeIf {
                    route.kind == TrailRouteKind.ExerciseLoop &&
                        deviation.status == TrailRouteDeviationStatus.ConfirmedOffRoute
                }
                ?.let { fix -> { kind: RerouteKind -> startReroute(fix, kind, requestedByRider = true) } },
            closureBlock = blockingAdvisories.firstOrNull()?.let { advisory ->
                RouteClosureBlock(
                    reason = "This route goes through a reported trail closure " +
                        "(${advisory.title.removeSuffix(" advisory")}). Recalculate to ride around it.",
                    noRouteMessage = closureNoRouteMessage,
                    recalculating = recalculatingAroundClosure,
                    onRecalculate = ::recalculateAroundClosure,
                    onReviewNotice = { reviewedAdvisoryId = advisory.id },
                )
            },
            onStartNavigation = {
                if (blockingAdvisories.isNotEmpty()) return@RouteMapBottomControls
                resetProgress()
                carriedRideJson = null
                deviation = TrailRouteDeviationState()
                lastRerouteAttempt = null
                pendingCompletedSession = null
                navigationMessageIsError = false
                if (context.hasForegroundLocationPermission()) {
                    locationPermissionGranted = true
                    navigationMessage = null
                    activeNavigation = true
                } else {
                    locationPermissionLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                        ),
                    )
                }
            },
            onStopNavigation = {
                cancelReroute()
                activeNavigation = false
                navigationMessage = null
                navigationMessageIsError = false
            },
            onShowDirections = { showDirectionsSheet = true },
            reversedDirection = reversedDirection,
            onReverseDirection = {
                reversedDirection = !reversedDirection
                cancelReroute()
                replacementRouteJson = null
                carriedRideJson = null
                supersededRoute = null
                // Progress belongs to one direction. A switch starts over rather than carrying
                // progress across, so an early turnaround cannot complete the reversed loop.
                resetProgress()
                navigationMessage = null
                navigationMessageIsError = false
            },
            modifier = Modifier.fillMaxWidth(),
        )
        }
    }

    renameText?.let { text ->
        AlertDialog(
            onDismissRequest = { renameText = null },
            title = { Text("Rename route") },
            text = {
                OutlinedTextField(
                    value = text,
                    onValueChange = { renameText = it },
                    label = { Text("Name") },
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        renameText = null
                        previewScope.launch {
                            val renamed = saveController.renameSavedRoute(text)
                            if (renamed == null) {
                                previewSnackbarHostState.showSnackbar("Unable to rename route.")
                            } else {
                                previewSnackbarHostState.showSnackbar("Renamed to ${renamed.title}")
                            }
                        }
                    },
                    enabled = text.isNotBlank(),
                ) {
                    Text("Save name")
                }
            },
            dismissButton = {
                TextButton(onClick = { renameText = null }) {
                    Text("Cancel")
                }
            },
        )
    }

    if (showDirectionsSheet && routeInstructions.isNotEmpty()) {
        ModalBottomSheet(
            onDismissRequest = { showDirectionsSheet = false },
            sheetState = directionsSheetState,
            scrimColor = Color.Transparent,
        ) {
            DirectionsBottomSheetContent(
                route = route,
                instructions = routeInstructions,
                accessMessage = accessMessage(
                    hasRoutedAccess = hasRoutedAccess,
                    hasEstimatedAccess = hasEstimatedAccess,
                ).takeIf { hasRoutedAccess || hasEstimatedAccess },
            )
        }
    }

    routeAdvisories.firstOrNull { it.id == reviewedAdvisoryId }?.let { advisory ->
        AlertDialog(
            onDismissRequest = { reviewedAdvisoryId = null },
            title = { Text(advisory.title) },
            text = {
                Column(
                    modifier = Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(advisory.message)
                    Text(advisory.locationDescription, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { uriHandler.openUri(TrailRouteAdvisorySijko.LatestClosureMapUrl) }) {
                        Text("Latest construction map")
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { uriHandler.openUri(advisory.sourceUrl) }) {
                    Text("Open city notice")
                }
            },
            dismissButton = {
                TextButton(onClick = { reviewedAdvisoryId = null }) {
                    Text("Close")
                }
            },
        )
    }
}

/** Why Start is disabled on a route through an active closure, and how to get past it. */
private class RouteClosureBlock(
    val reason: String,
    /** Why Recalculate found nothing, such as the closure's own detour guidance. */
    val noRouteMessage: String?,
    val recalculating: Boolean,
    val onRecalculate: () -> Unit,
    val onReviewNotice: () -> Unit,
)

@Composable
private fun RouteClosureBlockPanel(block: RouteClosureBlock) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = block.reason,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
        )
        block.noRouteMessage?.let { message ->
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(onClick = block.onRecalculate, enabled = !block.recalculating) {
                Text(if (block.recalculating) "Recalculating..." else "Recalculate")
            }
            TextButton(onClick = block.onReviewNotice) {
                Text("Review notice")
            }
        }
    }
}

/** Save, share and save-place actions for a previewed route; each confirms with a snackbar, not a dialog. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RoutePreviewActions(
    isSaved: Boolean,
    saveEnabled: Boolean,
    onSave: () -> Unit,
    onShare: () -> Unit,
    onSaveDestination: (() -> Unit)?,
    saveDestinationEnabled: Boolean,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        // Disabled until the saved-state lookup finishes and while a save is in flight.
        TextButton(onClick = onSave, enabled = saveEnabled) {
            Icon(
                imageVector = if (isSaved) Icons.Filled.Bookmark else Icons.Filled.BookmarkBorder,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Text(if (isSaved) "Saved" else "Save", modifier = Modifier.padding(start = 6.dp))
        }
        TextButton(onClick = onShare) {
            Icon(
                imageVector = Icons.Filled.Share,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Text("Share", modifier = Modifier.padding(start = 6.dp))
        }
        onSaveDestination?.let { saveDestination ->
            TextButton(onClick = saveDestination, enabled = saveDestinationEnabled) {
                Text("Save destination")
            }
        }
    }
}

@Composable
private fun RouteMapBottomControls(
    route: TrailRoute,
    routeInstructions: List<TrailRouteInstruction>,
    isSaved: Boolean,
    saveEnabled: Boolean,
    onSave: () -> Unit,
    onShare: () -> Unit,
    onSaveDestination: (() -> Unit)?,
    saveDestinationEnabled: Boolean,
    closureBlock: RouteClosureBlock?,
    activeNavigation: Boolean,
    navigationSnapshot: TrailRouteNavigationSnapshot?,
    navigationMessage: String?,
    navigationMessageIsError: Boolean,
    deviationStatus: TrailRouteDeviationStatus,
    rerouteInProgress: Boolean,
    onRecalculate: (() -> Unit)?,
    onLoopChoice: ((RerouteKind) -> Unit)?,
    onStartNavigation: () -> Unit,
    onStopNavigation: () -> Unit,
    onShowDirections: () -> Unit,
    reversedDirection: Boolean,
    onReverseDirection: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uriHandler = LocalUriHandler.current
    val canReverse = route.kind == TrailRouteKind.ExerciseLoop
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 4.dp,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (activeNavigation) {
                NavigationProgressFooter(
                    snapshot = navigationSnapshot,
                    message = navigationMessage,
                    messageIsError = navigationMessageIsError,
                    offRoute = deviationStatus == TrailRouteDeviationStatus.ConfirmedOffRoute,
                    onStop = onStopNavigation,
                )
                onRecalculate?.let { recalculate ->
                    TextButton(onClick = recalculate, enabled = !rerouteInProgress) {
                        Text(if (rerouteInProgress) "Calculating a new route..." else "Recalculate from here")
                    }
                }
                onLoopChoice?.let { choose ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = { choose(RerouteKind.RejoinLoop) },
                            enabled = !rerouteInProgress,
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(if (rerouteInProgress) "Calculating..." else "Rejoin the loop")
                        }
                        TextButton(
                            onClick = { choose(RerouteKind.ReturnToStart) },
                            enabled = !rerouteInProgress,
                        ) {
                            Text("Return to start")
                        }
                    }
                }
                if (canReverse) {
                    ReverseDirectionControl(reversedDirection = reversedDirection, onReverse = onReverseDirection)
                }
            } else {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.Place,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        tint = TRAIL_BRANCH_COLOR,
                    )
                    Text(
                        text = TrailRouteSummarySijko.summaryFor(route),
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                navigationMessage?.let { message ->
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (navigationMessageIsError) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.primary
                        },
                    )
                }

                closureBlock?.let { block -> RouteClosureBlockPanel(block) }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = onStartNavigation,
                        modifier = Modifier.weight(1f),
                        enabled = closureBlock == null,
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Navigation,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Text("Start navigation")
                    }
                    TextButton(
                        onClick = onShowDirections,
                        enabled = routeInstructions.isNotEmpty(),
                    ) {
                        Text("Directions")
                    }
                }
                RoutePreviewActions(
                    isSaved = isSaved,
                    saveEnabled = saveEnabled,
                    onSave = onSave,
                    onShare = onShare,
                    onSaveDestination = onSaveDestination,
                    saveDestinationEnabled = saveDestinationEnabled,
                )
                if (canReverse) {
                    ReverseDirectionControl(reversedDirection = reversedDirection, onReverse = onReverseDirection)
                }
            }

            Text(
                text = "Access data © OpenStreetMap contributors",
                modifier = Modifier
                    .align(Alignment.End)
                    .clickable { uriHandler.openUri(OPEN_STREET_MAP_COPYRIGHT_URL) },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun DirectionsBottomSheetContent(
    route: TrailRoute,
    instructions: List<TrailRouteInstruction>,
    accessMessage: String?,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "Directions",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = TrailRouteSummarySijko.summaryFor(route),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        accessMessage?.let { message ->
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = DIRECTIONS_SHEET_MAX_HEIGHT),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(instructions) { instruction ->
                TrailRouteInstructionRow(instruction = instruction)
            }
        }
    }
}

@Composable
private fun ActiveNavigationBanner(
    snapshot: TrailRouteNavigationSnapshot?,
    hasLiveLocation: Boolean,
    deviationStatus: TrailRouteDeviationStatus,
    rerouteInProgress: Boolean,
) {
    val nextInstruction = snapshot?.nextInstruction
    val distanceText = snapshot?.distanceToNextInstructionMeters?.let(
        TrailRouteInstructionDistanceSijko::labelFor,
    ) ?: "Now"
    Text(
        text = when {
            // Once a departure is confirmed, the old next turn is no longer current guidance.
            deviationStatus == TrailRouteDeviationStatus.ConfirmedOffRoute && rerouteInProgress ->
                "Off route - finding a new route"
            deviationStatus == TrailRouteDeviationStatus.ConfirmedOffRoute -> "Off route - head back to the route line"
            nextInstruction == null -> "Waiting for route"
            else -> "$distanceText - ${nextInstruction.text}"
        },
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurface,
    )
    Text(
        text = when {
            !hasLiveLocation -> "Waiting for GPS"
            snapshot == null -> "Finding route position"
            deviationStatus == TrailRouteDeviationStatus.UncertainPosition -> "Weak GPS signal"
            snapshot.distanceFromRouteMeters > OFF_ROUTE_WARNING_METERS -> {
                "Off route by ${TrailRouteInstructionDistanceSijko.labelFor(snapshot.distanceFromRouteMeters)}"
            }
            else -> "${formatNavigationMiles(snapshot.remainingDistanceMeters)} remaining"
        },
        style = MaterialTheme.typography.bodySmall,
        color = if (snapshot != null && snapshot.distanceFromRouteMeters > OFF_ROUTE_WARNING_METERS) {
            MaterialTheme.colorScheme.error
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
    )
}

@Composable
private fun NavigationProgressFooter(
    snapshot: TrailRouteNavigationSnapshot?,
    message: String?,
    messageIsError: Boolean,
    offRoute: Boolean,
    onStop: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = when {
                    snapshot == null -> "Waiting for GPS"
                    // The remaining distance assumes the rider is on the route, so it is not shown off it.
                    offRoute -> "Off route"
                    else -> "${formatNavigationMiles(snapshot.remainingDistanceMeters)} remaining"
                },
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            message?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (messageIsError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                )
            }
        }
        Button(onClick = onStop) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Text("Stop")
        }
    }
}

@Composable
private fun ReverseDirectionControl(
    reversedDirection: Boolean,
    onReverse: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = if (reversedDirection) "Riding in reverse" else "Planned direction",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(onClick = onReverse) {
            Text("Reverse direction")
        }
    }
}

@Composable
private fun rememberNavigationLocationFix(
    active: Boolean,
    permissionGranted: Boolean,
): TrailRouteNavigationFix? {
    val context = LocalContext.current
    var locationFix by remember { mutableStateOf<TrailRouteNavigationFix?>(null) }

    DisposableEffect(context, active, permissionGranted) {
        if (!active || !permissionGranted || !context.hasForegroundLocationPermission()) {
            onDispose { }
        } else {
            val fusedLocationClient = LocationServices.getFusedLocationProviderClient(context)
            val locationRequest = LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                LOCATION_UPDATE_INTERVAL_MILLIS,
            )
                .setMinUpdateIntervalMillis(LOCATION_FASTEST_INTERVAL_MILLIS)
                .setMinUpdateDistanceMeters(LOCATION_MIN_DISTANCE_METERS)
                .build()
            val callback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    result.lastLocation?.let { location -> locationFix = location.toNavigationFix() }
                }
            }

            try {
                // A cached last location may be old; its timestamp lets the deviation check discount it.
                fusedLocationClient.lastLocation.addOnSuccessListener { location ->
                    location?.let { locationFix = it.toNavigationFix() }
                }
                fusedLocationClient.requestLocationUpdates(
                    locationRequest,
                    callback,
                    Looper.getMainLooper(),
                )
            } catch (_: SecurityException) {
                locationFix = null
            }

            onDispose {
                fusedLocationClient.removeLocationUpdates(callback)
            }
        }
    }

    return locationFix
}

private fun Location.toNavigationFix() = TrailRouteNavigationFix(
    point = MapPoint(latitude = latitude, longitude = longitude),
    accuracyMeters = if (hasAccuracy()) accuracy.toDouble() else null,
    timeEpochMillis = time,
)

@Composable
private fun TrailRouteMapUnavailableScreen(onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Route map unavailable",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        IconButton(onClick = onBack) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
            )
        }
    }
}

@Composable
private fun TrailRouteInstructionRow(instruction: TrailRouteInstruction) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = TrailRouteInstructionDistanceSijko.labelFor(instruction.distanceMeters),
            modifier = Modifier.width(64.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = instruction.text,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun RouteSegmentPolylines(segment: TrailRouteSegment, directionStamp: BitmapDescriptor?) {
    val points = segment.points.map { it.toLatLng() }
    Polyline(
        points = points,
        color = segment.polylineBaseColor(),
        width = segment.polylineWidth(),
        pattern = segment.polylineBasePattern(),
        zIndex = segment.polylineZIndex(),
    )
    segment.polylineOverlayColor()?.let { overlayColor ->
        Polyline(
            points = points,
            color = overlayColor,
            width = segment.polylineOverlayWidth(),
            pattern = segment.polylineOverlayPattern(),
            zIndex = segment.polylineZIndex() + ROUTE_OVERLAY_Z_INDEX_OFFSET,
        )
    }
    // A transparent line stamped with chevrons, above the legend colors, shows the direction of travel.
    directionStamp?.let { stamp ->
        Polyline(
            points = points,
            spans = listOf(
                StyleSpan(
                    StrokeStyle.colorBuilder(android.graphics.Color.TRANSPARENT)
                        .stamp(TextureStyle.newBuilder(stamp).build())
                        .build(),
                ),
            ),
            width = segment.polylineWidth(),
            zIndex = segment.polylineZIndex() + DIRECTION_STAMP_Z_INDEX_OFFSET,
        )
    }
}

private fun MapPoint.toLatLng(): LatLng {
    return LatLng(latitude, longitude)
}

private fun List<LatLng>.toBoundsOrNull(): LatLngBounds? {
    val distinctPoints = distinctBy { "${it.latitude},${it.longitude}" }
    if (distinctPoints.size < MINIMUM_BOUNDS_POINT_COUNT) {
        return null
    }
    return LatLngBounds.builder().apply {
        distinctPoints.forEach(::include)
    }.build()
}

private fun accessMessage(
    hasRoutedAccess: Boolean,
    hasEstimatedAccess: Boolean,
): String {
    return when {
        hasRoutedAccess && hasEstimatedAccess -> {
            "Blue access lines follow mapped roads; dotted access lines are estimated gaps where local road data is incomplete."
        }
        hasRoutedAccess -> "Blue access lines follow mapped ordinary roads to the trail network."
        else -> "Dotted access lines are estimated because no mapped road/path access route was found."
    }
}

private fun Context.hasForegroundLocationPermission(): Boolean {
    return ContextCompat.checkSelfPermission(
        this,
        Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
}

private fun formatNavigationMiles(distanceMeters: Double): String {
    val miles = kotlin.math.round(distanceMeters / METERS_PER_MILE * 10.0) / 10.0
    return "${miles.toString().trimTrailingZero()} mi"
}

private fun String.trimTrailingZero(): String {
    return if (endsWith(".0")) {
        dropLast(2)
    } else {
        this
    }
}

private const val ROUTE_OVERLAY_Z_INDEX_OFFSET = 0.1f
private const val DIRECTION_STAMP_Z_INDEX_OFFSET = 0.2f
private const val RIDDEN_OVERLAY_Z_INDEX = 2.5f
private const val RIDDEN_OVERLAY_WIDTH = 20f
private const val TURNAROUND_MARKER_Z_INDEX = 5f
private val RIDDEN_OVERLAY_COLOR = Color(0x99FFFFFF)
private const val DEFAULT_ROUTE_ZOOM = 13f

// The share image cache file name for a route that has not been saved.
private const val UNSAVED_SHARE_ID = "unsaved-route"
private const val ROUTE_CAMERA_PADDING_PIXELS = 140
private const val MINIMUM_BOUNDS_POINT_COUNT = 2
private const val MINIMUM_DRAWABLE_SEGMENT_POINT_COUNT = 2
private const val OPEN_STREET_MAP_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
private const val ACTIVE_NAVIGATION_ZOOM = 18f
private const val ACTIVE_NAVIGATION_TILT = 55f
private const val LOCATION_UPDATE_INTERVAL_MILLIS = 1_000L
private const val LOCATION_FASTEST_INTERVAL_MILLIS = 500L
private const val LOCATION_MIN_DISTANCE_METERS = 2f
private enum class RerouteKind { PointToPoint, RejoinLoop, ReturnToStart }

private const val SUPERSEDED_ROUTE_WIDTH = 8f
private const val SUPERSEDED_ROUTE_Z_INDEX = 0.5f
private val SUPERSEDED_ROUTE_COLOR = Color(0x80808080)
private const val OFF_ROUTE_WARNING_METERS = TrailRouteNavigationSnapshotSijko.OFF_ROUTE_METERS
private const val METERS_PER_MILE = 1609.344
private val DIRECTIONS_SHEET_MAX_HEIGHT = 560.dp
private val ADVISORY_CORRIDOR_COLOR = Color(0xFFCE7019)
