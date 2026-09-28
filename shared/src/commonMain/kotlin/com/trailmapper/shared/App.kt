/**
 * Job: Host the shared Compose application and route-planner UI, wiring user actions to Sijkos and platform providers.
 *
 */
package com.trailmapper.shared

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.DirectionsBike
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material.icons.filled.PinDrop
import androidx.compose.material.icons.filled.Route
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.launch
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteSummarySijko
import com.trailmapper.shared.routing.ExerciseRouteStatus
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.routing.TrailRouteAdvisorySijko
import com.trailmapper.shared.sijko.AddressPlaceholderVisibilitySijko
import com.trailmapper.shared.sijko.CurrentLocationEndpointAvailabilitySijko
import com.trailmapper.shared.sijko.LocationPermissionRevokeStatus
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpointTarget
import com.trailmapper.shared.sijko.RouteSearchAvailabilitySijko
import com.trailmapper.shared.sijko.SavedItemAccessibilityMessageSijko
import com.trailmapper.shared.sijko.SavedTrailRouteFilterSijko
import com.trailmapper.shared.sijko.SavedDestinationEditorSaveAvailabilitySijko
import com.trailmapper.shared.sijko.TrailResourceLinksSijko
import com.trailmapper.shared.sijko.TrailRouteLayer

@Composable
fun App(
    currentLocationAddressProvider: CurrentLocationAddressProvider = NoCurrentLocationAddressProvider,
    addressAutocompleteProvider: AddressAutocompleteProvider = NoAddressAutocompleteProvider,
    mapPointSelectionProvider: MapPointSelectionProvider = NoMapPointSelectionProvider,
    trailNetworkProvider: TrailNetworkProvider = NoTrailNetworkProvider,
    accessNetworkProvider: AccessNetworkProvider = NoAccessNetworkProvider,
    trailRouteMapPresenter: TrailRouteMapPresenter = NoTrailRouteMapPresenter,
    trailNetworkMapPresenter: TrailNetworkMapPresenter = NoTrailNetworkMapPresenter,
    externalLinkOpener: ExternalLinkOpener = NoExternalLinkOpener,
    savedTrailRouteStore: SavedTrailRouteStore = NoSavedTrailRouteStore,
    savedDestinationStore: SavedDestinationStore = NoSavedDestinationStore,
    completedExerciseSessionStore: CompletedExerciseSessionStore = NoCompletedExerciseSessionStore,
    trailAccountProvider: TrailAccountProvider = NoTrailAccountProvider,
    trailRouteShareProvider: TrailRouteShareProvider = NoTrailRouteShareProvider,
    recentTrailRouteStore: RecentTrailRouteStore = NoRecentTrailRouteStore,
    developerOptionsActions: DeveloperOptionsActions? = null,
) {
    MaterialTheme(colorScheme = TrailMapperColorScheme) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
        ) {
            val trailMapperViewModel: TrailMapperViewModel = viewModel {
                TrailMapperViewModel(
                    savedTrailRouteStore = savedTrailRouteStore,
                    savedDestinationStore = savedDestinationStore,
                    trailAccountProvider = trailAccountProvider,
                    recentTrailRouteStore = recentTrailRouteStore,
                )
            }
            val appState by trailMapperViewModel.uiState.collectAsStateWithLifecycle()
            val navController = rememberNavController()
            var routePlannerDestinationId by rememberSaveable { mutableStateOf<String?>(null) }
            // The route map saves straight to the stores, so pick up its changes on return.
            LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
                trailMapperViewModel.refreshSavedItems()
            }

            NavHost(
                navController = navController,
                startDestination = TrailMapperScreen.Home.route,
                modifier = Modifier.fillMaxSize(),
            ) {
                composable(TrailMapperScreen.Home.route) {
                    LaunchedEffect(Unit) {
                        routePlannerDestinationId = null
                        trailMapperViewModel.refreshSavedItems()
                    }
                    TrailMapperHome(
                        appState = appState,
                        addressAutocompleteProvider = addressAutocompleteProvider,
                        mapPointSelectionProvider = mapPointSelectionProvider,
                        externalLinkOpener = externalLinkOpener,
                        trailRouteMapPresenter = trailRouteMapPresenter,
                        trailNetworkMapPresenter = trailNetworkMapPresenter,
                        trailRouteShareProvider = trailRouteShareProvider,
                        onSignInWithGoogle = trailMapperViewModel::signInWithGoogle,
                        onSignOut = trailMapperViewModel::signOut,
                        onOpenAbout = {
                            navController.navigate(TrailMapperScreen.About.route) {
                                launchSingleTop = true
                            }
                        },
                        onOpenLocalGuide = {
                            navController.navigate(TrailMapperScreen.LocalGuide.route) { launchSingleTop = true }
                        },
                        onCreateRoute = {
                            routePlannerDestinationId = null
                            navController.navigate(TrailMapperScreen.RoutePlanner.route) {
                                launchSingleTop = true
                            }
                        },
                        onCreateExerciseRoute = {
                            navController.navigate(TrailMapperScreen.ExerciseRoutePlanner.route) {
                                launchSingleTop = true
                            }
                        },
                        onNavigateToDestination = { destination ->
                            trailMapperViewModel.requestNavigateToDestination(
                                destination = destination,
                                currentLocationAddressProvider = currentLocationAddressProvider,
                                trailNetworkProvider = trailNetworkProvider,
                                accessNetworkProvider = accessNetworkProvider,
                                onRouteFound = { route ->
                                    trailRouteMapPresenter.showTrailRoute(
                                        route,
                                        TrailRoutePreviewRequest(
                                            destination = TrailRoutePreviewDestination(destination.address, destination.point),
                                        ),
                                    )
                                },
                            )
                        },
                        onOpenRecentRoute = { entry ->
                            trailRouteMapPresenter.showTrailRoute(entry.route, TrailRoutePreviewRequest(title = entry.title))
                        },
                        onRemoveRecentRoute = trailMapperViewModel::removeRecentRoute,
                        onRestoreRecentRoute = trailMapperViewModel::restoreRecentRoute,
                        onClearRecentRoutes = trailMapperViewModel::clearRecentRoutes,
                        onCreateRouteFromDestination = { destination ->
                            routePlannerDestinationId = destination.id
                            navController.navigate(TrailMapperScreen.RoutePlanner.route) {
                                launchSingleTop = true
                            }
                        },
                        onSaveDestination = { name, address, point ->
                            trailMapperViewModel.saveDestination(
                                address = address,
                                point = point,
                                customName = name,
                            )
                        },
                        onRenameSavedDestination = trailMapperViewModel::renameSavedDestination,
                        onDeleteSavedDestination = trailMapperViewModel::deleteSavedDestination,
                        onRenameSavedRoute = trailMapperViewModel::renameSavedRoute,
                        onDeleteSavedRoute = trailMapperViewModel::deleteSavedRoute,
                    )
                }

                composable(TrailMapperScreen.RoutePlanner.route) {
                    val routePlannerDestination = routePlannerDestinationId?.let { destinationId ->
                        appState.savedDestinations.firstOrNull { destination ->
                            destination.id == destinationId
                        }
                    }
                    RoutePlanner(
                        initialDestinationId = routePlannerDestinationId,
                        initialDestination = routePlannerDestination,
                        isLoadingInitialDestination = appState.isLoadingSavedDestinations,
                        currentLocationAddressProvider = currentLocationAddressProvider,
                        addressAutocompleteProvider = addressAutocompleteProvider,
                        mapPointSelectionProvider = mapPointSelectionProvider,
                        trailNetworkProvider = trailNetworkProvider,
                        accessNetworkProvider = accessNetworkProvider,
                        trailRouteMapPresenter = trailRouteMapPresenter,
                        developerOptionsActions = developerOptionsActions,
                        onOpenLocalGuide = {
                            navController.navigate(TrailMapperScreen.LocalGuide.route) { launchSingleTop = true }
                        },
                        externalLinkOpener = externalLinkOpener,
                        onBack = { navController.navigateUp() },
                    )
                }

                composable(TrailMapperScreen.ExerciseRoutePlanner.route) {
                    ExerciseRoutePlanner(
                        currentLocationAddressProvider = currentLocationAddressProvider,
                        addressAutocompleteProvider = addressAutocompleteProvider,
                        mapPointSelectionProvider = mapPointSelectionProvider,
                        trailNetworkProvider = trailNetworkProvider,
                        accessNetworkProvider = accessNetworkProvider,
                        completedExerciseSessionStore = completedExerciseSessionStore,
                        trailRouteMapPresenter = trailRouteMapPresenter,
                        trailRouteShareProvider = trailRouteShareProvider,
                        developerOptionsActions = developerOptionsActions,
                        onOpenLocalGuide = {
                            navController.navigate(TrailMapperScreen.LocalGuide.route) { launchSingleTop = true }
                        },
                        externalLinkOpener = externalLinkOpener,
                        onBack = { navController.navigateUp() },
                        onSaveRoute = trailMapperViewModel::saveRoute,
                    )
                }

                composable(TrailMapperScreen.About.route) {
                    TrailMapperAbout.Screen(
                        externalLinkOpener = externalLinkOpener,
                        onBack = { navController.navigateUp() },
                    )
                }
                composable(TrailMapperScreen.LocalGuide.route) {
                    LocalTrailGuideScreen(
                        externalLinkOpener = externalLinkOpener,
                        onBack = { navController.navigateUp() },
                    )
                }
            }

            appState.saveMessage?.let { message ->
                AlertDialog(
                    onDismissRequest = trailMapperViewModel::dismissSaveMessage,
                    title = { Text("Saved routes") },
                    text = { Text(message) },
                    confirmButton = {
                        TextButton(onClick = trailMapperViewModel::dismissSaveMessage) {
                            Text("OK")
                        }
                    },
                )
            }

            appState.accountMessage?.let { message ->
                AlertDialog(
                    onDismissRequest = trailMapperViewModel::dismissAccountMessage,
                    title = { Text("Google account") },
                    text = { Text(message) },
                    confirmButton = {
                        TextButton(onClick = trailMapperViewModel::dismissAccountMessage) {
                            Text("OK")
                        }
                    },
                )
            }

            appState.pendingNavigationDestination?.let { destination ->
                AlertDialog(
                    onDismissRequest = trailMapperViewModel::dismissNavigateToDestinationPrompt,
                    title = { Text("Use current location?") },
                    text = {
                        Text(
                            "Trail Mapper needs your device location to route from where you are now to ${destination.title}.",
                        )
                    },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                trailMapperViewModel.confirmNavigateToDestination(
                                    currentLocationAddressProvider = currentLocationAddressProvider,
                                    trailNetworkProvider = trailNetworkProvider,
                                    accessNetworkProvider = accessNetworkProvider,
                                    onRouteFound = trailRouteMapPresenter::showTrailRoute,
                                )
                            },
                        ) {
                            Text("Continue")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = trailMapperViewModel::dismissNavigateToDestinationPrompt) {
                            Text("Not now")
                        }
                    },
                )
            }

            appState.destinationMessage?.let { message ->
                AlertDialog(
                    onDismissRequest = trailMapperViewModel::dismissDestinationMessage,
                    title = { Text("Saved destination") },
                    text = { Text(message) },
                    confirmButton = {
                        TextButton(onClick = trailMapperViewModel::dismissDestinationMessage) {
                            Text("OK")
                        }
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun TrailMapperHome(
    appState: TrailMapperUiState,
    addressAutocompleteProvider: AddressAutocompleteProvider,
    mapPointSelectionProvider: MapPointSelectionProvider,
    externalLinkOpener: ExternalLinkOpener,
    trailRouteMapPresenter: TrailRouteMapPresenter,
    trailNetworkMapPresenter: TrailNetworkMapPresenter,
    trailRouteShareProvider: TrailRouteShareProvider,
    onSignInWithGoogle: () -> Unit,
    onSignOut: () -> Unit,
    onOpenAbout: () -> Unit,
    onOpenLocalGuide: () -> Unit,
    onCreateRoute: () -> Unit,
    onCreateExerciseRoute: () -> Unit,
    onNavigateToDestination: (SavedDestination) -> Unit,
    onCreateRouteFromDestination: (SavedDestination) -> Unit,
    onOpenRecentRoute: (RecentTrailRoute) -> Unit,
    onRemoveRecentRoute: (RecentTrailRoute) -> Unit,
    onRestoreRecentRoute: (RecentTrailRoute) -> Unit,
    onClearRecentRoutes: () -> Unit,
    onSaveDestination: (String, String, MapPoint) -> Unit,
    onRenameSavedDestination: (String, String) -> Unit,
    onDeleteSavedDestination: (String) -> Unit,
    onRenameSavedRoute: (String, String) -> Unit,
    onDeleteSavedRoute: (String) -> Unit,
) {
    val resourceLinks = remember { TrailResourceLinksSijko.links() }
    val savedDestinationEditorViewModel: SavedDestinationEditorViewModel = viewModel {
        SavedDestinationEditorViewModel()
    }
    val savedDestinationEditorState by savedDestinationEditorViewModel.uiState.collectAsStateWithLifecycle()
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    var showAddDestinationDialog by rememberSaveable { mutableStateOf(false) }
    var showAccountSheet by remember { mutableStateOf(false) }
    var editingDestinationId by rememberSaveable { mutableStateOf<String?>(null) }
    var editingRouteId by rememberSaveable { mutableStateOf<String?>(null) }
    var destinationPendingRename by remember { mutableStateOf<SavedDestination?>(null) }
    var destinationPendingDelete by remember { mutableStateOf<SavedDestination?>(null) }
    var routePendingRename by remember { mutableStateOf<SavedTrailRoute?>(null) }
    var routePendingDelete by remember { mutableStateOf<SavedTrailRoute?>(null) }
    val savedItemSnackbarHostState = remember { SnackbarHostState() }
    var savedItemStatusMessage by remember { mutableStateOf<String?>(null) }
    val homeScope = rememberCoroutineScope()
    var confirmClearRecents by remember { mutableStateOf(false) }

    fun removeRecentRoute(entry: RecentTrailRoute) {
        onRemoveRecentRoute(entry)
        homeScope.launch {
            savedItemSnackbarHostState.currentSnackbarData?.dismiss()
            val result = savedItemSnackbarHostState.showSnackbar(
                message = "Removed ${entry.title} from recents",
                actionLabel = "Undo",
            )
            if (result == SnackbarResult.ActionPerformed) onRestoreRecentRoute(entry)
        }
    }
    val savedNavigationRoutes = SavedTrailRouteFilterSijko.navigationRoutes(appState.savedRoutes)
    val savedExerciseRoutes = SavedTrailRouteFilterSijko.exerciseRoutes(appState.savedRoutes)

    fun clearSavedItemEditMode() {
        editingDestinationId = null
        editingRouteId = null
    }

    fun exitSavedItemEditMode() {
        val editedTitle = editingDestinationId
            ?.let { destinationId ->
                appState.savedDestinations.firstOrNull { it.id == destinationId }?.title
            }
            ?: editingRouteId?.let { routeId ->
                appState.savedRoutes.firstOrNull { it.id == routeId }?.title
            }
        clearSavedItemEditMode()
        editedTitle?.let { title ->
            savedItemStatusMessage = SavedItemAccessibilityMessageSijko.editingExited(title)
        }
    }

    LaunchedEffect(savedItemStatusMessage) {
        val message = savedItemStatusMessage ?: return@LaunchedEffect
        savedItemSnackbarHostState.currentSnackbarData?.dismiss()
        savedItemSnackbarHostState.showSnackbar(message)
        if (savedItemStatusMessage == message) {
            savedItemStatusMessage = null
        }
    }

    PlatformBackHandler(
        enabled = editingDestinationId != null || editingRouteId != null,
        onBack = ::exitSavedItemEditMode,
    )

    LaunchedEffect(appState.savedDestinations, appState.savedRoutes) {
        editingDestinationId?.let { destinationId ->
            if (appState.savedDestinations.none { destination -> destination.id == destinationId }) {
                editingDestinationId = null
            }
        }
        editingRouteId?.let { routeId ->
            if (appState.savedRoutes.none { route -> route.id == routeId }) {
                editingRouteId = null
            }
        }
    }

    fun openAddDestinationDialog() {
        savedDestinationEditorViewModel.reset()
        showAddDestinationDialog = true
    }

    fun requestDestinationMapPoint() {
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
        savedDestinationEditorViewModel.requestMapPoint(mapPointSelectionProvider)
    }

    fun selectDestinationPrediction(prediction: AddressAutocompletePrediction) {
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
        savedDestinationEditorViewModel.selectAutocompletePrediction(
            prediction = prediction,
            provider = addressAutocompleteProvider,
        )
    }

    TrailMapperNavigationDrawer(
        resourceLinks = resourceLinks,
        onOpenAbout = onOpenAbout,
        onOpenLocalGuide = onOpenLocalGuide,
        onOpenResource = { link -> externalLinkOpener.open(link.url) },
    ) { openMenu ->
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            snackbarHost = { SnackbarHost(savedItemSnackbarHostState) },
            topBar = {
                TrailMapperTopAppBar(
                    account = appState.account,
                    isResolvingAccount = appState.isResolvingAccount,
                    onOpenMenu = openMenu,
                    onOpenAccount = { showAccountSheet = true },
                )
            },
            containerColor = MaterialTheme.colorScheme.background,
        ) { scaffoldPadding ->
            val layoutDirection = LocalLayoutDirection.current
            val startInset = if (layoutDirection == LayoutDirection.Ltr) {
                scaffoldPadding.calculateLeftPadding(layoutDirection)
            } else {
                scaffoldPadding.calculateRightPadding(layoutDirection)
            }
            val endInset = if (layoutDirection == LayoutDirection.Ltr) {
                scaffoldPadding.calculateRightPadding(layoutDirection)
            } else {
                scaffoldPadding.calculateLeftPadding(layoutDirection)
            }
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .consumeWindowInsets(scaffoldPadding),
                contentPadding = PaddingValues(
                    start = startInset + 20.dp,
                    top = scaffoldPadding.calculateTopPadding() + 16.dp,
                    end = endInset + 20.dp,
                    bottom = scaffoldPadding.calculateBottomPadding() + 16.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                item {
                    TrailInformationSection()
                }

                if (appState.recentRoutes.isNotEmpty()) {
                    item {
                        RecentRoutesHeader(onClear = { confirmClearRecents = true })
                    }
                    items(
                        items = appState.recentRoutes,
                        key = { entry -> "recent-${entry.id}" },
                    ) { entry ->
                        RecentTrailRouteRow(
                            entry = entry,
                            detail = RecentTrailRouteHistorySijko.detailFor(entry, appState.recentRoutesLoadedAtEpochMillis),
                            openEnabled = trailRouteMapPresenter.isAvailable,
                            onOpen = { onOpenRecentRoute(entry) },
                            onRemove = { removeRecentRoute(entry) },
                        )
                    }
                }

                item {
                    HomeSectionHeader(title = "Trail maps")
                }

                item {
                    TrailMapResources(
                        resourceLinks = resourceLinks,
                        externalLinkOpener = externalLinkOpener,
                        trailNetworkMapPresenter = trailNetworkMapPresenter,
                        onOpenLocalGuide = onOpenLocalGuide,
                    )
                }

                item {
                    HomeSectionHeader(
                        title = "Destinations",
                        onAdd = ::openAddDestinationDialog,
                        addContentDescription = "Add saved destination",
                    )
                }

                if (appState.isLoadingSavedDestinations) {
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        }
                    }
                } else if (appState.savedDestinations.isEmpty()) {
                    item {
                        Text(
                            text = "Destinations will appear here after you add one or save one from a route.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    items(
                        items = appState.savedDestinations,
                        key = SavedDestination::id,
                    ) { savedDestination ->
                        SavedDestinationRow(
                            savedDestination = savedDestination,
                            navigationEnabled = trailRouteMapPresenter.isAvailable,
                            isNavigating = appState.navigatingDestinationId == savedDestination.id,
                            isEditing = editingDestinationId == savedDestination.id,
                            onNavigate = { onNavigateToDestination(savedDestination) },
                            onCreateRoute = { onCreateRouteFromDestination(savedDestination) },
                            onEnterEditMode = {
                                editingDestinationId = savedDestination.id
                                editingRouteId = null
                                savedItemStatusMessage =
                                    SavedItemAccessibilityMessageSijko.editing(savedDestination.title)
                            },
                            onCancelEditMode = ::exitSavedItemEditMode,
                            onEdit = { destinationPendingRename = savedDestination },
                            onDelete = { destinationPendingDelete = savedDestination },
                        )
                    }
                }

                item {
                    HomeSectionHeader(
                        title = "Trail navigation routes",
                        onAdd = onCreateRoute,
                        addContentDescription = "Create trail navigation route",
                    )
                }

                if (appState.isLoadingSavedRoutes) {
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        }
                    }
                } else if (savedNavigationRoutes.isEmpty()) {
                    item {
                        Text(
                            text = "Trail navigation routes will appear here after you find and save one.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    items(
                        items = savedNavigationRoutes,
                        key = SavedTrailRoute::id,
                    ) { savedRoute ->
                        SavedTrailRouteRow(
                            savedRoute = savedRoute,
                            enabled = trailRouteMapPresenter.isAvailable,
                            sharingEnabled = trailRouteShareProvider.isAvailable,
                            isEditing = editingRouteId == savedRoute.id,
                            onOpen = { trailRouteMapPresenter.showTrailRoute(savedRoute.route) },
                            onShare = { trailRouteShareProvider.share(savedRoute) },
                            onEnterEditMode = {
                                editingRouteId = savedRoute.id
                                editingDestinationId = null
                                savedItemStatusMessage =
                                    SavedItemAccessibilityMessageSijko.editing(savedRoute.title)
                            },
                            onCancelEditMode = ::exitSavedItemEditMode,
                            onEdit = { routePendingRename = savedRoute },
                            onDelete = { routePendingDelete = savedRoute },
                        )
                    }
                }

                item {
                    HomeSectionHeader(
                        title = "Exercise routes",
                        onAdd = onCreateExerciseRoute,
                        addContentDescription = "Create exercise route",
                    )
                }

                if (appState.isLoadingSavedRoutes) {
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        }
                    }
                } else if (savedExerciseRoutes.isEmpty()) {
                    item {
                        Text(
                            text = "Exercise routes will appear here after you create and save a loop.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    items(
                        items = savedExerciseRoutes,
                        key = SavedTrailRoute::id,
                    ) { savedRoute ->
                        SavedTrailRouteRow(
                            savedRoute = savedRoute,
                            enabled = trailRouteMapPresenter.isAvailable,
                            sharingEnabled = trailRouteShareProvider.isAvailable,
                            isEditing = editingRouteId == savedRoute.id,
                            onOpen = { trailRouteMapPresenter.showTrailRoute(savedRoute.route) },
                            onShare = { trailRouteShareProvider.share(savedRoute) },
                            onEnterEditMode = {
                                editingRouteId = savedRoute.id
                                editingDestinationId = null
                                savedItemStatusMessage =
                                    SavedItemAccessibilityMessageSijko.editing(savedRoute.title)
                            },
                            onCancelEditMode = ::exitSavedItemEditMode,
                            onEdit = { routePendingRename = savedRoute },
                            onDelete = { routePendingDelete = savedRoute },
                        )
                    }
                }
            }
        }
    }

    if (showAccountSheet) {
        TrailAccountSheet(
            account = appState.account,
            isResolvingAccount = appState.isResolvingAccount,
            onDismiss = { showAccountSheet = false },
            onSignInWithGoogle = {
                showAccountSheet = false
                onSignInWithGoogle()
            },
            onSignOut = {
                showAccountSheet = false
                onSignOut()
            },
        )
    }

    if (showAddDestinationDialog) {
        AddSavedDestinationDialog(
            state = savedDestinationEditorState,
            onNameChange = savedDestinationEditorViewModel::updateName,
            onAddressChange = {
                savedDestinationEditorViewModel.updateAddress(
                    address = it,
                    autocompleteProvider = addressAutocompleteProvider,
                )
            },
            onChooseOnMap = ::requestDestinationMapPoint,
            onAutocompleteSelected = ::selectDestinationPrediction,
            onDismiss = {
                showAddDestinationDialog = false
                savedDestinationEditorViewModel.reset()
            },
            onSave = {
                val point = savedDestinationEditorState.point
                if (point != null) {
                    onSaveDestination(
                        savedDestinationEditorState.name,
                        savedDestinationEditorState.address,
                        point,
                    )
                    showAddDestinationDialog = false
                    savedDestinationEditorViewModel.reset()
                }
            },
        )
    }

    destinationPendingRename?.let { destination ->
        SavedItemRenameDialog(
            itemLabel = "destination",
            currentTitle = destination.title,
            onDismiss = {
                destinationPendingRename = null
                exitSavedItemEditMode()
            },
            onRename = { title ->
                onRenameSavedDestination(destination.id, title)
                destinationPendingRename = null
                clearSavedItemEditMode()
                savedItemStatusMessage = SavedItemAccessibilityMessageSijko.renamed(
                    itemLabel = "Destination",
                    title = title,
                )
            },
        )
    }

    destinationPendingDelete?.let { destination ->
        SavedItemDeleteDialog(
            itemLabel = "destination",
            itemTitle = destination.title,
            onDismiss = {
                destinationPendingDelete = null
                exitSavedItemEditMode()
            },
            onDelete = {
                onDeleteSavedDestination(destination.id)
                destinationPendingDelete = null
                clearSavedItemEditMode()
                savedItemStatusMessage = SavedItemAccessibilityMessageSijko.deleted(
                    itemLabel = "Destination",
                    title = destination.title,
                )
            },
        )
    }

    routePendingRename?.let { route ->
        SavedItemRenameDialog(
            itemLabel = "saved route",
            currentTitle = route.title,
            onDismiss = {
                routePendingRename = null
                exitSavedItemEditMode()
            },
            onRename = { title ->
                onRenameSavedRoute(route.id, title)
                routePendingRename = null
                clearSavedItemEditMode()
                savedItemStatusMessage = SavedItemAccessibilityMessageSijko.renamed(
                    itemLabel = "Saved route",
                    title = title,
                )
            },
        )
    }

    routePendingDelete?.let { route ->
        SavedItemDeleteDialog(
            itemLabel = "saved route",
            itemTitle = route.title,
            onDismiss = {
                routePendingDelete = null
                exitSavedItemEditMode()
            },
            onDelete = {
                onDeleteSavedRoute(route.id)
                routePendingDelete = null
                clearSavedItemEditMode()
                savedItemStatusMessage = SavedItemAccessibilityMessageSijko.deleted(
                    itemLabel = "Saved route",
                    title = route.title,
                )
            },
        )
    }

    if (confirmClearRecents) {
        val count = appState.recentRoutes.size
        AlertDialog(
            onDismissRequest = { confirmClearRecents = false },
            title = { Text(if (count == 1) "Clear 1 recent route?" else "Clear $count recent routes?") },
            text = { Text("Saved routes and places aren't affected.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmClearRecents = false
                        // A Remove's Undo no longer applies once everything is cleared.
                        savedItemSnackbarHostState.currentSnackbarData?.dismiss()
                        onClearRecentRoutes()
                    },
                ) {
                    Text("Clear")
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmClearRecents = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun AddSavedDestinationDialog(
    state: SavedDestinationEditorUiState,
    onNameChange: (String) -> Unit,
    onAddressChange: (String) -> Unit,
    onChooseOnMap: () -> Unit,
    onAutocompleteSelected: (AddressAutocompletePrediction) -> Unit,
    onDismiss: () -> Unit,
    onSave: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Save destination") },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = state.name,
                    onValueChange = onNameChange,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Name") },
                    singleLine = true,
                )
                LocationInput(
                    label = "Address",
                    value = state.address,
                    onValueChange = onAddressChange,
                    onUseCurrentLocation = null,
                    onChooseOnMap = onChooseOnMap,
                    isResolvingCurrentLocation = false,
                    isChoosingMapPoint = state.isChoosingMapPoint,
                    autocompleteSuggestions = state.autocompleteSuggestions,
                    isResolvingAutocomplete = state.isResolvingAutocomplete,
                    autocompleteError = state.autocompleteError,
                    onAutocompleteSelected = onAutocompleteSelected,
                )
                state.mapPointError?.let { error ->
                    Text(
                        text = error,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = onSave,
                enabled = SavedDestinationEditorSaveAvailabilitySijko.canSave(
                    name = state.name,
                    address = state.address,
                    point = state.point,
                ),
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrailMapperTopAppBar(
    account: TrailUserAccount?,
    isResolvingAccount: Boolean,
    onOpenMenu: () -> Unit,
    onOpenAccount: () -> Unit,
) {
    TopAppBar(
        navigationIcon = {
            IconButton(onClick = onOpenMenu) {
                Icon(
                    imageVector = Icons.Filled.Menu,
                    contentDescription = "Open menu",
                )
            }
        },
        title = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TrailMapperMark(modifier = Modifier.size(36.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Trail Mapper",
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "Bloomington-Normal",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
        actions = {
            if (isResolvingAccount) {
                Box(
                    modifier = Modifier.size(48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(22.dp))
                }
            } else {
                IconButton(onClick = onOpenAccount) {
                    if (account == null) {
                        Icon(
                            imageVector = Icons.Filled.AccountCircle,
                            contentDescription = "Open account sign-in",
                        )
                    } else {
                        TrailAccountProfileImage(
                            account = account,
                            contentDescription = "Open account for ${account.displayName}",
                            modifier = Modifier.size(32.dp),
                        )
                    }
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.background,
            titleContentColor = MaterialTheme.colorScheme.onBackground,
            navigationIconContentColor = MaterialTheme.colorScheme.onBackground,
            actionIconContentColor = MaterialTheme.colorScheme.onBackground,
        ),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrailAccountSheet(
    account: TrailUserAccount?,
    isResolvingAccount: Boolean,
    onDismiss: () -> Unit,
    onSignInWithGoogle: () -> Unit,
    onSignOut: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(
                text = "Account",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )

            when {
                isResolvingAccount -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    }
                }

                account == null -> {
                    Text(
                        text = "Not signed in",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Box(
                        modifier = Modifier.fillMaxWidth(),
                        contentAlignment = Alignment.Center,
                    ) {
                        TrailGoogleSignInButton(
                            enabled = true,
                            onClick = onSignInWithGoogle,
                        )
                    }
                }

                else -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TrailAccountProfileImage(
                            account = account,
                            contentDescription = null,
                            modifier = Modifier.size(56.dp),
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = account.displayName,
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = account.email,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    HorizontalDivider()
                    TextButton(
                        onClick = onSignOut,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Logout,
                                contentDescription = null,
                            )
                            Text("Sign out")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TrailInformationSection() {
    Column(
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = "Constitution Trail",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = "Plan rides on Constitution Trail, local connectors and shared-road sections, " +
                "with ordinary roads used for access.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun RecentRoutesHeader(onClear: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = "Recent",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        TextButton(onClick = onClear) {
            Text("Clear recents")
        }
    }
}

/** A recent, unsaved route: a clock marks it apart from saved rows, which carry a bookmark. */
@Composable
private fun RecentTrailRouteRow(
    entry: RecentTrailRoute,
    detail: String,
    openEnabled: Boolean,
    onOpen: () -> Unit,
    onRemove: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .heightIn(min = 56.dp)
                .clickable(enabled = openEnabled, onClickLabel = "Open map", onClick = onOpen),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Filled.History,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column {
                Text(
                    text = entry.title,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        IconButton(onClick = onRemove) {
            Icon(
                imageVector = Icons.Filled.Close,
                contentDescription = "Remove ${entry.title} from recents",
            )
        }
    }
}

@Composable
private fun HomeSectionHeader(
    title: String,
    onAdd: (() -> Unit)? = null,
    addContentDescription: String? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        if (onAdd != null) {
            IconButton(onClick = onAdd) {
                Icon(
                    imageVector = Icons.Filled.Add,
                    contentDescription = addContentDescription,
                )
            }
        }
    }
}

@Composable
private fun TrailMapResources(
    resourceLinks: List<TrailResourceLink>,
    externalLinkOpener: ExternalLinkOpener,
    trailNetworkMapPresenter: TrailNetworkMapPresenter,
    onOpenLocalGuide: () -> Unit,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (trailNetworkMapPresenter.isAvailable) {
            TrailResourceRow(
                link = TrailResourceLink("Trail Mapper map", "", "County trails, verified local additions and reported closure areas"),
                onOpen = trailNetworkMapPresenter::showTrailNetwork,
                external = false,
            )
        }
        LocalTrailGuideShortcut(onOpen = onOpenLocalGuide)
        resourceLinks
            .filter(TrailResourceLink::showOnHome)
            .forEach { link ->
                TrailResourceRow(
                    link = link,
                    onOpen = { externalLinkOpener.open(link.url) },
                )
            }
    }
}

@Composable
private fun TrailResourceRow(
    link: TrailResourceLink,
    onOpen: () -> Unit,
    external: Boolean = true,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Filled.Map,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(link.title, style = MaterialTheme.typography.bodyMedium)
                link.description?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (external) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SavedDestinationRow(
    savedDestination: SavedDestination,
    navigationEnabled: Boolean,
    isNavigating: Boolean,
    isEditing: Boolean,
    onNavigate: () -> Unit,
    onCreateRoute: () -> Unit,
    onEnterEditMode: () -> Unit,
    onCancelEditMode: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val cardColor = if (isEditing) {
        MaterialTheme.colorScheme.errorContainer
    } else {
        MaterialTheme.colorScheme.surface
    }
    val primaryContentColor = if (isEditing) {
        MaterialTheme.colorScheme.onErrorContainer
    } else {
        MaterialTheme.colorScheme.onSurface
    }
    val secondaryContentColor = if (isEditing) {
        MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.78f)
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    val canEnterEditMode = !isEditing

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .savedItemEditMotion(isEditing)
            .savedItemLongPressOnly(
                onLongClickLabel = if (canEnterEditMode) {
                    "Edit ${savedDestination.title}"
                } else {
                    null
                },
                onLongPress = onEnterEditMode.takeIf { canEnterEditMode },
            ),
        shape = RoundedCornerShape(8.dp),
        tonalElevation = 1.dp,
        color = cardColor,
    ) {
        Box(modifier = Modifier.heightIn(min = 76.dp)) {
            if (isEditing) {
                IconButton(
                    onClick = onCancelEditMode,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(start = 2.dp, top = 2.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Exit edit mode for ${savedDestination.title}",
                        tint = primaryContentColor,
                    )
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        start = if (isEditing) 54.dp else 14.dp,
                        top = 14.dp,
                        end = 10.dp,
                        bottom = 14.dp,
                    ),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!isEditing) {
                    Icon(
                        imageVector = Icons.Filled.LocationOn,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = savedDestination.title,
                        style = MaterialTheme.typography.titleSmall,
                        color = primaryContentColor,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = savedDestination.address,
                        style = MaterialTheme.typography.bodySmall,
                        color = secondaryContentColor,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (isEditing) {
                    IconButton(onClick = onEdit) {
                        Icon(
                            imageVector = Icons.Filled.Edit,
                            contentDescription = "Rename ${savedDestination.title}",
                            tint = primaryContentColor,
                        )
                    }
                    IconButton(onClick = onDelete) {
                        Icon(
                            imageVector = Icons.Filled.Delete,
                            contentDescription = "Delete ${savedDestination.title}",
                            tint = primaryContentColor,
                        )
                    }
                } else {
                    IconButton(onClick = onCreateRoute) {
                        Icon(
                            imageVector = Icons.Filled.Route,
                            contentDescription = "Create route to ${savedDestination.title}",
                        )
                    }
                    FilledIconButton(
                        onClick = onNavigate,
                        enabled = navigationEnabled && !isNavigating,
                    ) {
                        if (isNavigating) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Filled.Navigation,
                                contentDescription = "Navigate to ${savedDestination.title}",
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SavedTrailRouteRow(
    savedRoute: SavedTrailRoute,
    enabled: Boolean,
    sharingEnabled: Boolean,
    isEditing: Boolean,
    onOpen: () -> Unit,
    onShare: () -> Unit,
    onEnterEditMode: () -> Unit,
    onCancelEditMode: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val cardColor = if (isEditing) {
        MaterialTheme.colorScheme.errorContainer
    } else {
        MaterialTheme.colorScheme.surface
    }
    val primaryContentColor = if (isEditing) {
        MaterialTheme.colorScheme.onErrorContainer
    } else {
        MaterialTheme.colorScheme.onSurface
    }
    val secondaryContentColor = if (isEditing) {
        MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.78f)
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    val canOpen = enabled && !isEditing
    val canEnterEditMode = !isEditing

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .savedItemEditMotion(isEditing)
            .then(
                if (canOpen) {
                    Modifier.combinedClickable(
                        onClick = onOpen,
                        onClickLabel = "Open ${savedRoute.title}",
                        onLongClickLabel = "Edit ${savedRoute.title}",
                        onLongClick = onEnterEditMode,
                    )
                } else {
                    Modifier.savedItemLongPressOnly(
                        onLongClickLabel = if (canEnterEditMode) {
                            "Edit ${savedRoute.title}"
                        } else {
                            null
                        },
                        onLongPress = onEnterEditMode.takeIf { canEnterEditMode },
                    )
                },
            ),
        shape = RoundedCornerShape(8.dp),
        tonalElevation = 1.dp,
        color = cardColor,
    ) {
        Box(modifier = Modifier.heightIn(min = 76.dp)) {
            if (isEditing) {
                IconButton(
                    onClick = onCancelEditMode,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(start = 2.dp, top = 2.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = "Exit edit mode for ${savedRoute.title}",
                        tint = primaryContentColor,
                    )
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        start = if (isEditing) 54.dp else 14.dp,
                        top = 14.dp,
                        end = 10.dp,
                        bottom = 14.dp,
                    ),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!isEditing) {
                    Icon(
                        imageVector = if (savedRoute.route.kind == TrailRouteKind.ExerciseLoop) {
                            Icons.AutoMirrored.Filled.DirectionsBike
                        } else {
                            Icons.Filled.Bookmark
                        },
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = savedRoute.title,
                        style = MaterialTheme.typography.titleSmall,
                        color = primaryContentColor,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = savedRoute.summary,
                        style = MaterialTheme.typography.bodySmall,
                        color = secondaryContentColor,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (isEditing) {
                    IconButton(onClick = onEdit) {
                        Icon(
                            imageVector = Icons.Filled.Edit,
                            contentDescription = "Rename ${savedRoute.title}",
                            tint = primaryContentColor,
                        )
                    }
                    IconButton(onClick = onDelete) {
                        Icon(
                            imageVector = Icons.Filled.Delete,
                            contentDescription = "Delete ${savedRoute.title}",
                            tint = primaryContentColor,
                        )
                    }
                } else {
                    IconButton(
                        onClick = onShare,
                        enabled = sharingEnabled,
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Share,
                            contentDescription = "Share ${savedRoute.title}",
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun TrailMapperMark(modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val center = Offset(size.width / 2f, size.height / 2f)
        val radius = size.minDimension / 2f
        drawCircle(Color(0xFFF7F4EA), radius = radius, center = center)
        drawCircle(Color(0xFF2BB673), radius = radius * 0.72f, center = center)
        val pinPath = Path().apply {
            moveTo(center.x, size.height * 0.12f)
            cubicTo(size.width * 0.86f, size.height * 0.2f, size.width * 0.82f, size.height * 0.64f, center.x, size.height * 0.9f)
            cubicTo(size.width * 0.18f, size.height * 0.64f, size.width * 0.14f, size.height * 0.2f, center.x, size.height * 0.12f)
            close()
        }
        drawPath(pinPath, Color(0xFF173B34))
        val trailPath = Path().apply {
            moveTo(size.width * 0.34f, size.height * 0.28f)
            cubicTo(size.width * 0.62f, size.height * 0.34f, size.width * 0.34f, size.height * 0.52f, size.width * 0.58f, size.height * 0.62f)
            cubicTo(size.width * 0.74f, size.height * 0.7f, size.width * 0.42f, size.height * 0.78f, size.width * 0.5f, size.height * 0.88f)
        }
        drawPath(
            path = trailPath,
            color = Color.White,
            style = Stroke(width = radius * 0.13f, cap = StrokeCap.Round),
        )
        drawLine(
            color = Color(0xFFFFDE17),
            start = Offset(size.width * 0.28f, size.height * 0.35f),
            end = Offset(size.width * 0.48f, size.height * 0.22f),
            strokeWidth = radius * 0.08f,
            cap = StrokeCap.Round,
        )
        drawLine(
            color = Color(0xFF58B0E2),
            start = Offset(size.width * 0.66f, size.height * 0.28f),
            end = Offset(size.width * 0.78f, size.height * 0.48f),
            strokeWidth = radius * 0.08f,
            cap = StrokeCap.Round,
        )
        drawLine(
            color = Color(0xFFFBB040),
            start = Offset(size.width * 0.66f, size.height * 0.58f),
            end = Offset(size.width * 0.78f, size.height * 0.72f),
            strokeWidth = radius * 0.08f,
            cap = StrokeCap.Round,
        )
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun ExerciseRoutePlanner(
    currentLocationAddressProvider: CurrentLocationAddressProvider,
    addressAutocompleteProvider: AddressAutocompleteProvider,
    mapPointSelectionProvider: MapPointSelectionProvider,
    trailNetworkProvider: TrailNetworkProvider,
    accessNetworkProvider: AccessNetworkProvider,
    completedExerciseSessionStore: CompletedExerciseSessionStore,
    trailRouteMapPresenter: TrailRouteMapPresenter,
    trailRouteShareProvider: TrailRouteShareProvider,
    developerOptionsActions: DeveloperOptionsActions?,
    onOpenLocalGuide: () -> Unit,
    externalLinkOpener: ExternalLinkOpener,
    onBack: () -> Unit,
    onSaveRoute: (TrailRoute) -> Unit,
) {
    val viewModel: ExerciseRoutePlannerViewModel = viewModel {
        ExerciseRoutePlannerViewModel(completedExerciseSessionStore)
    }
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    var showDeveloperOptions by remember { mutableStateOf(false) }

    // A new loop opens straight onto its map once; the result card stays for reopening it after Back.
    val resultAwaitingMap = uiState.result?.takeIf { uiState.resultAwaitingMap }
    LaunchedEffect(resultAwaitingMap) {
        val result = resultAwaitingMap ?: return@LaunchedEffect
        viewModel.markResultShownOnMap()
        if (trailRouteMapPresenter.isAvailable) {
            trailRouteMapPresenter.showTrailRoute(result.route)
        }
    }

    fun hideInput() {
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            RoutePlannerTopAppBar(
                title = "Create exercise route",
                onBack = onBack,
                onLongPress = if (developerOptionsActions == null) {
                    null
                } else {
                    { showDeveloperOptions = true }
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { scaffoldPadding ->
        val layoutDirection = LocalLayoutDirection.current
        val startInset = if (layoutDirection == LayoutDirection.Ltr) {
            scaffoldPadding.calculateLeftPadding(layoutDirection)
        } else {
            scaffoldPadding.calculateRightPadding(layoutDirection)
        }
        val endInset = if (layoutDirection == LayoutDirection.Ltr) {
            scaffoldPadding.calculateRightPadding(layoutDirection)
        } else {
            scaffoldPadding.calculateLeftPadding(layoutDirection)
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .consumeWindowInsets(scaffoldPadding),
            contentPadding = PaddingValues(
                start = startInset + 24.dp,
                top = scaffoldPadding.calculateTopPadding() + 12.dp,
                end = endInset + 24.dp,
                bottom = scaffoldPadding.calculateBottomPadding() + 24.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { LocalTrailGuideShortcut(onOpen = onOpenLocalGuide, compact = true) }
            item {
                LocationInput(
                    label = "Start",
                    value = uiState.startAddress,
                    onValueChange = {
                        viewModel.updateStartAddress(it, addressAutocompleteProvider)
                    },
                    onUseCurrentLocation = {
                        hideInput()
                        viewModel.requestCurrentLocation(currentLocationAddressProvider)
                    },
                    onChooseOnMap = {
                        hideInput()
                        viewModel.requestMapPoint(mapPointSelectionProvider)
                    },
                    isResolvingCurrentLocation = uiState.isResolvingLocation,
                    isChoosingMapPoint = uiState.isResolvingMapPoint,
                    autocompleteSuggestions = uiState.autocompleteSuggestions,
                    isResolvingAutocomplete = uiState.isResolvingAutocomplete,
                    autocompleteError = uiState.autocompleteError,
                    onAutocompleteSelected = { prediction ->
                        hideInput()
                        viewModel.selectAutocompletePrediction(
                            prediction = prediction,
                            provider = addressAutocompleteProvider,
                        )
                    },
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.targetMilesText,
                    onValueChange = viewModel::setTargetMilesText,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Target distance") },
                    suffix = { Text("mi") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
            }

            item {
                RouteLayer(
                    label = "Include proposed trails",
                    checked = uiState.proposedTrailsEnabled,
                    onCheckedChange = viewModel::setProposedTrailsEnabled,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            item {
                Button(
                    onClick = {
                        hideInput()
                        viewModel.findExerciseRoute(
                            trailNetworkProvider = trailNetworkProvider,
                            accessNetworkProvider = accessNetworkProvider,
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !uiState.isFindingRoute && !uiState.hasPendingEndpointRequest,
                ) {
                    if (uiState.isFindingRoute) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.DirectionsBike,
                            contentDescription = null,
                        )
                        Text("Create exercise route")
                    }
                }
            }

            uiState.searchError?.let { message ->
                item {
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            uiState.result?.let { result ->
                item {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        tonalElevation = 2.dp,
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(
                                text = if (result.status == ExerciseRouteStatus.Exact) {
                                    "Exercise loop ready"
                                } else {
                                    "Closest available loop"
                                },
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = result.summary,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            TrailRouteAdvisorySijko.forRoute(result.route).forEach { advisory ->
                                TrailRouteAdvisoryBanner(advisory, onReview = { externalLinkOpener.open(advisory.sourceUrl) })
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Button(
                                    onClick = { trailRouteMapPresenter.showTrailRoute(result.route) },
                                    modifier = Modifier.weight(1f),
                                    enabled = trailRouteMapPresenter.isAvailable,
                                ) {
                                    Icon(
                                        imageVector = Icons.Filled.Map,
                                        contentDescription = null,
                                    )
                                    Text("Map")
                                }
                                // With a map, the loop is saved from its map like any route.
                                if (!trailRouteMapPresenter.isAvailable) {
                                    OutlinedButton(
                                        onClick = { onSaveRoute(result.route) },
                                        modifier = Modifier.weight(1f),
                                    ) {
                                        Icon(
                                            imageVector = Icons.Filled.Bookmark,
                                            contentDescription = null,
                                        )
                                        Text("Save")
                                    }
                                }
                                if (trailRouteShareProvider.isAvailable) {
                                    IconButton(
                                        onClick = {
                                            trailRouteShareProvider.share(
                                                SavedTrailRoute(
                                                    id = result.routeKey,
                                                    title = "Exercise route",
                                                    summary = result.summary,
                                                    route = result.route,
                                                ),
                                            )
                                        },
                                    ) {
                                        Icon(
                                            imageVector = Icons.Filled.Share,
                                            contentDescription = "Share exercise route",
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (uiState.pendingLocationPrompt) {
        AlertDialog(
            onDismissRequest = viewModel::dismissCurrentLocationPrompt,
            title = { Text("Use current location?") },
            text = {
                Text("Trail Mapper needs your device location to choose the exercise route start.")
            },
            confirmButton = {
                TextButton(
                    onClick = { viewModel.confirmCurrentLocation(currentLocationAddressProvider) },
                ) {
                    Text("Continue")
                }
            },
            dismissButton = {
                TextButton(onClick = viewModel::dismissCurrentLocationPrompt) {
                    Text("Not now")
                }
            },
        )
    }

    uiState.locationError?.let { message ->
        AlertDialog(
            onDismissRequest = viewModel::dismissLocationError,
            title = { Text("Location unavailable") },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = viewModel::dismissLocationError) { Text("OK") }
            },
        )
    }

    uiState.mapPointError?.let { message ->
        AlertDialog(
            onDismissRequest = viewModel::dismissMapPointError,
            title = { Text("Map unavailable") },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = viewModel::dismissMapPointError) { Text("OK") }
            },
        )
    }

    if (showDeveloperOptions && developerOptionsActions != null) {
        DeveloperOptionsDialog(
            developerOptionsActions = developerOptionsActions,
            onDismiss = { showDeveloperOptions = false },
        )
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun RoutePlanner(
    initialDestinationId: String?,
    initialDestination: SavedDestination?,
    isLoadingInitialDestination: Boolean,
    currentLocationAddressProvider: CurrentLocationAddressProvider,
    addressAutocompleteProvider: AddressAutocompleteProvider,
    mapPointSelectionProvider: MapPointSelectionProvider,
    trailNetworkProvider: TrailNetworkProvider,
    accessNetworkProvider: AccessNetworkProvider,
    trailRouteMapPresenter: TrailRouteMapPresenter,
    developerOptionsActions: DeveloperOptionsActions?,
    onOpenLocalGuide: () -> Unit,
    externalLinkOpener: ExternalLinkOpener,
    onBack: () -> Unit,
) {
    val routePlannerViewModel: RoutePlannerViewModel = viewModel { RoutePlannerViewModel() }
    val uiState by routePlannerViewModel.uiState.collectAsStateWithLifecycle()
    var showDeveloperOptions by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current

    LaunchedEffect(
        initialDestinationId,
        initialDestination?.id,
        isLoadingInitialDestination,
    ) {
        if (!isLoadingInitialDestination) {
            routePlannerViewModel.prepareRoute(initialDestination)
        }
    }

    fun requestCurrentLocation(target: RouteEndpointTarget) {
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
        routePlannerViewModel.requestCurrentLocation(target, currentLocationAddressProvider)
    }

    fun requestMapPoint(target: RouteEndpointTarget) {
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
        routePlannerViewModel.requestMapPoint(target, mapPointSelectionProvider)
    }

    fun selectAutocompletePrediction(
        target: RouteEndpointTarget,
        prediction: AddressAutocompletePrediction,
    ) {
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
        routePlannerViewModel.selectAutocompletePrediction(
            target = target,
            prediction = prediction,
            provider = addressAutocompleteProvider,
        )
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            RoutePlannerTopAppBar(
                title = "Create trail route",
                onBack = onBack,
                onLongPress = if (developerOptionsActions == null) {
                    null
                } else {
                    { showDeveloperOptions = true }
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { scaffoldPadding ->
        val layoutDirection = LocalLayoutDirection.current
        val startInset = if (layoutDirection == LayoutDirection.Ltr) {
            scaffoldPadding.calculateLeftPadding(layoutDirection)
        } else {
            scaffoldPadding.calculateRightPadding(layoutDirection)
        }
        val endInset = if (layoutDirection == LayoutDirection.Ltr) {
            scaffoldPadding.calculateRightPadding(layoutDirection)
        } else {
            scaffoldPadding.calculateLeftPadding(layoutDirection)
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .consumeWindowInsets(scaffoldPadding),
            contentPadding = PaddingValues(
                start = startInset + 24.dp,
                top = scaffoldPadding.calculateTopPadding() + 16.dp,
                end = endInset + 24.dp,
                bottom = scaffoldPadding.calculateBottomPadding() + 24.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { LocalTrailGuideShortcut(onOpen = onOpenLocalGuide, compact = true) }
            item {
                LocationInput(
                    label = "Start",
                    value = uiState.endpoints.start,
                    onValueChange = {
                        routePlannerViewModel.updateEndpointText(
                            target = RouteEndpointTarget.Start,
                            text = it,
                            autocompleteProvider = addressAutocompleteProvider,
                        )
                    },
                    onUseCurrentLocation = if (
                        CurrentLocationEndpointAvailabilitySijko.isAvailableFor(RouteEndpointTarget.Start)
                    ) {
                        { requestCurrentLocation(RouteEndpointTarget.Start) }
                    } else {
                        null
                    },
                    onChooseOnMap = { requestMapPoint(RouteEndpointTarget.Start) },
                    isResolvingCurrentLocation = uiState.resolvingLocationTarget == RouteEndpointTarget.Start,
                    isChoosingMapPoint = uiState.resolvingMapPointTarget == RouteEndpointTarget.Start,
                    autocompleteSuggestions = uiState.autocompleteSuggestions.takeIf {
                        uiState.autocompleteTarget == RouteEndpointTarget.Start
                    }.orEmpty(),
                    isResolvingAutocomplete = uiState.isResolvingAutocomplete &&
                        uiState.autocompleteTarget == RouteEndpointTarget.Start,
                    autocompleteError = uiState.autocompleteError.takeIf {
                        uiState.autocompleteTarget == RouteEndpointTarget.Start
                    },
                    onAutocompleteSelected = {
                        selectAutocompletePrediction(
                            target = RouteEndpointTarget.Start,
                            prediction = it,
                        )
                    },
                )
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    IconButton(onClick = routePlannerViewModel::swapEndpoints) {
                        Icon(
                            imageVector = Icons.Filled.SwapVert,
                            contentDescription = "Swap start and destination",
                        )
                    }
                }
            }

            item {
                LocationInput(
                    label = "Destination",
                    value = uiState.endpoints.destination,
                    onValueChange = {
                        routePlannerViewModel.updateEndpointText(
                            target = RouteEndpointTarget.Destination,
                            text = it,
                            autocompleteProvider = addressAutocompleteProvider,
                        )
                    },
                    onUseCurrentLocation = if (
                        CurrentLocationEndpointAvailabilitySijko.isAvailableFor(RouteEndpointTarget.Destination)
                    ) {
                        { requestCurrentLocation(RouteEndpointTarget.Destination) }
                    } else {
                        null
                    },
                    onChooseOnMap = { requestMapPoint(RouteEndpointTarget.Destination) },
                    isResolvingCurrentLocation = uiState.resolvingLocationTarget == RouteEndpointTarget.Destination,
                    isChoosingMapPoint = uiState.resolvingMapPointTarget == RouteEndpointTarget.Destination,
                    autocompleteSuggestions = uiState.autocompleteSuggestions.takeIf {
                        uiState.autocompleteTarget == RouteEndpointTarget.Destination
                    }.orEmpty(),
                    isResolvingAutocomplete = uiState.isResolvingAutocomplete &&
                        uiState.autocompleteTarget == RouteEndpointTarget.Destination,
                    autocompleteError = uiState.autocompleteError.takeIf {
                        uiState.autocompleteTarget == RouteEndpointTarget.Destination
                    },
                    onAutocompleteSelected = {
                        selectAutocompletePrediction(
                            target = RouteEndpointTarget.Destination,
                            prediction = it,
                        )
                    },
                )
            }

            item {
                RouteLayer(
                    label = "Proposed trails",
                    checked = uiState.routeLayers.proposedTrails,
                    onCheckedChange = {
                        routePlannerViewModel.setLayerChecked(TrailRouteLayer.ProposedTrails, it)
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            item {
                Button(
                    onClick = {
                        routePlannerViewModel.findTrailRoute(
                            trailNetworkProvider = trailNetworkProvider,
                            accessNetworkProvider = accessNetworkProvider,
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = RouteSearchAvailabilitySijko.canSearch(uiState.endpoints) &&
                        !uiState.isFindingRoute && !uiState.hasPendingEndpointRequest,
                ) {
                    if (uiState.isFindingRoute) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp))
                    } else {
                        Text("Find Trail Route")
                    }
                }
            }

            uiState.lastRoute
                ?.takeIf { trailRouteMapPresenter.isAvailable && !uiState.isFindingRoute }
                ?.let { route ->
                    item {
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(8.dp),
                            tonalElevation = 2.dp,
                            color = MaterialTheme.colorScheme.surface,
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Route ready",
                                        style = MaterialTheme.typography.titleSmall,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        text = TrailRouteSummarySijko.summaryFor(route),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                Button(
                                    onClick = {
                                        trailRouteMapPresenter.showTrailRoute(
                                            route,
                                            routePreviewRequest(uiState.endpoints.destination, uiState.endpoints.destinationPoint),
                                        )
                                    },
                                ) {
                                    Icon(imageVector = Icons.Filled.Map, contentDescription = null)
                                    Text("Open map")
                                }
                            }
                        }
                    }
                }
        }
    }

    uiState.pendingLocationTarget?.let { target ->
        AlertDialog(
            onDismissRequest = routePlannerViewModel::dismissCurrentLocationPrompt,
            title = { Text("Use current location?") },
            text = {
                Text(
                    "Trail Mapper needs your device location to fill the ${target.label.lowercase()} address.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = { routePlannerViewModel.confirmCurrentLocation(currentLocationAddressProvider) },
                ) {
                    Text("Continue")
                }
            },
            dismissButton = {
                TextButton(onClick = routePlannerViewModel::dismissCurrentLocationPrompt) {
                    Text("Not now")
                }
            },
        )
    }

    uiState.locationError?.let { message ->
        AlertDialog(
            onDismissRequest = routePlannerViewModel::dismissLocationError,
            title = { Text("Location unavailable") },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = routePlannerViewModel::dismissLocationError) {
                    Text("OK")
                }
            },
        )
    }

    uiState.mapPointError?.let { message ->
        AlertDialog(
            onDismissRequest = routePlannerViewModel::dismissMapPointError,
            title = { Text("Map unavailable") },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = routePlannerViewModel::dismissMapPointError) {
                    Text("OK")
                }
            },
        )
    }

    uiState.routeDialog?.let { dialog ->
        val drawableRoute = dialog.route.takeIf { trailRouteMapPresenter.isAvailable }
        if (drawableRoute != null) {
            // Nothing asks the rider to save first; saving and sharing happen on the map.
            LaunchedEffect(dialog) {
                routePlannerViewModel.dismissRouteDialog()
                trailRouteMapPresenter.showTrailRoute(
                    drawableRoute,
                    routePreviewRequest(uiState.endpoints.destination, uiState.endpoints.destinationPoint),
                )
            }
            return@let
        }
        AlertDialog(
            onDismissRequest = routePlannerViewModel::dismissRouteDialog,
            title = { Text(dialog.title) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(dialog.message)
                    dialog.route?.let { route ->
                        TrailRouteAdvisorySijko.forRoute(route).forEach { advisory ->
                            TrailRouteAdvisoryBanner(advisory, onReview = { externalLinkOpener.open(advisory.sourceUrl) })
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = routePlannerViewModel::dismissRouteDialog) {
                    Text("OK")
                }
            },
        )
    }

    if (showDeveloperOptions && developerOptionsActions != null) {
        DeveloperOptionsDialog(
            developerOptionsActions = developerOptionsActions,
            onDismiss = { showDeveloperOptions = false },
        )
    }
}

private fun routePreviewRequest(
    destinationAddress: String,
    destinationPoint: MapPoint?,
): TrailRoutePreviewRequest {
    return TrailRoutePreviewRequest(
        destination = destinationPoint?.let { point -> TrailRoutePreviewDestination(destinationAddress, point) },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RoutePlannerTopAppBar(
    title: String,
    onBack: () -> Unit,
    onLongPress: (() -> Unit)?,
) {
    TopAppBar(
        modifier = if (onLongPress == null) {
            Modifier
        } else {
            Modifier.pointerInput(onLongPress) {
                detectTapGestures(onLongPress = { onLongPress() })
            }
        },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back to home",
                )
            }
        },
        title = {
            Text(
                text = title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.background,
            titleContentColor = MaterialTheme.colorScheme.onBackground,
            navigationIconContentColor = MaterialTheme.colorScheme.onBackground,
        ),
    )
}

@Composable
private fun DeveloperOptionsDialog(
    developerOptionsActions: DeveloperOptionsActions,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Developer options") },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Button(
                    onClick = {
                        onDismiss()
                        developerOptionsActions.openAppSettings()
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Open app settings")
                }

                Button(
                    onClick = {
                        onDismiss()
                        developerOptionsActions.revokeLocationPermissions()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = developerOptionsActions.canRevokeLocationPermissions,
                ) {
                    Text("Revoke location permissions")
                }

                if (!developerOptionsActions.canRevokeLocationPermissions) {
                    Text(
                        text = when (developerOptionsActions.locationPermissionRevokeStatus) {
                            LocationPermissionRevokeStatus.Available -> ""
                            LocationPermissionRevokeStatus.UnsupportedPlatform -> {
                                "Permission self-revocation requires Android 13 or newer."
                            }
                            LocationPermissionRevokeStatus.NoForegroundPermissionGranted -> {
                                "Location permissions are already revoked. Use the current-location icon to test the request flow."
                            }
                        },
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Close")
            }
        },
    )
}

@Composable
private fun LocationInput(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    onUseCurrentLocation: (() -> Unit)?,
    onChooseOnMap: () -> Unit,
    isResolvingCurrentLocation: Boolean,
    isChoosingMapPoint: Boolean,
    autocompleteSuggestions: List<AddressAutocompletePrediction>,
    isResolvingAutocomplete: Boolean,
    autocompleteError: String?,
    onAutocompleteSelected: (AddressAutocompletePrediction) -> Unit,
) {
    var isFocused by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { isFocused = it.isFocused },
            label = { Text(label) },
            placeholder = {
                if (AddressPlaceholderVisibilitySijko.shouldShowPlaceholder(value, isFocused)) {
                    Text("Address or place")
                }
            },
            singleLine = true,
            leadingIcon = {
                Icon(
                    imageVector = Icons.Filled.Search,
                    contentDescription = null,
                )
            },
            trailingIcon = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (onUseCurrentLocation != null) {
                        IconButton(
                            onClick = onUseCurrentLocation,
                            enabled = !isResolvingCurrentLocation,
                        ) {
                            if (isResolvingCurrentLocation) {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp))
                            } else {
                                Icon(
                                    imageVector = Icons.Filled.MyLocation,
                                    contentDescription = "Use current location for $label",
                                )
                            }
                        }
                    }

                    IconButton(
                        onClick = onChooseOnMap,
                        enabled = !isChoosingMapPoint,
                    ) {
                        if (isChoosingMapPoint) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp))
                        } else {
                            Icon(
                                imageVector = Icons.Filled.PinDrop,
                                contentDescription = "Choose $label on map",
                            )
                        }
                    }
                }
            },
        )

        AddressAutocompletePanel(
            suggestions = autocompleteSuggestions,
            isResolving = isResolvingAutocomplete,
            error = autocompleteError,
            onSuggestionSelected = onAutocompleteSelected,
            modifier = Modifier
                .fillMaxWidth()
                .padding(end = 64.dp),
        )
    }
}

@Composable
private fun AddressAutocompletePanel(
    suggestions: List<AddressAutocompletePrediction>,
    isResolving: Boolean,
    error: String?,
    onSuggestionSelected: (AddressAutocompletePrediction) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!isResolving && suggestions.isEmpty() && error == null) {
        return
    }

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        tonalElevation = 2.dp,
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier.padding(vertical = 4.dp),
        ) {
            if (isResolving) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp))
                    Text(
                        text = "Finding addresses...",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            suggestions.forEach { suggestion ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSuggestionSelected(suggestion) }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
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
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            if (isResolving || suggestions.isNotEmpty()) {
                Text(
                    text = "Powered by Google",
                    modifier = Modifier
                        .align(Alignment.End)
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun RouteLayer(
    label: String,
    checked: Boolean,
    modifier: Modifier = Modifier,
    onCheckedChange: ((Boolean) -> Unit)? = null,
) {
    Row(
        modifier = modifier.heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            checked = checked,
            onCheckedChange = onCheckedChange,
            enabled = onCheckedChange != null,
            modifier = Modifier.size(48.dp),
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

private val TrailMapperColorScheme = lightColorScheme(
    primary = Color(0xFF08725F),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFCDEFE7),
    onPrimaryContainer = Color(0xFF093B33),
    secondary = Color(0xFF4D6888),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDDE8F3),
    onSecondaryContainer = Color(0xFF18324B),
    tertiary = Color(0xFFF59E0B),
    onTertiary = Color(0xFF2E1C00),
    background = Color(0xFFF8FBF7),
    onBackground = Color(0xFF18211F),
    surface = Color.White,
    onSurface = Color(0xFF18211F),
    surfaceVariant = Color(0xFFE7F0EC),
    onSurfaceVariant = Color(0xFF4C5A56),
    error = Color(0xFFB3261E),
    onError = Color.White,
)
