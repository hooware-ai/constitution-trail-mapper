/**
 * Job: Host the shared Compose application and route-planner UI, wiring user actions to Sijkos and platform providers.
 *
 */
package com.trailmapper.shared

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Loop
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import com.trailmapper.shared.routing.TrailRouteClosureGateSijko
import com.trailmapper.shared.sijko.SavedTrailRouteDetailSijko
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import com.trailmapper.shared.sijko.SavedItemSnackbarSijko
import com.trailmapper.shared.sijko.SavedItemStatusQueue
import com.trailmapper.shared.sijko.TrailAccountSheetContent
import com.trailmapper.shared.sijko.TrailAccountSheetSijko
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
                        onAccountMessageShown = trailMapperViewModel::dismissAccountMessage,
                        onOpenAbout = {
                            navController.navigate(TrailMapperScreen.About.route) {
                                launchSingleTop = true
                            }
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
                        onSaveMessageShown = trailMapperViewModel::dismissSaveMessage,
                        onDestinationMessageShown = trailMapperViewModel::dismissDestinationMessage,
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
    onAccountMessageShown: () -> Unit,
    onOpenAbout: () -> Unit,
    onCreateRoute: () -> Unit,
    onCreateExerciseRoute: () -> Unit,
    onNavigateToDestination: (SavedDestination) -> Unit,
    onCreateRouteFromDestination: (SavedDestination) -> Unit,
    onOpenRecentRoute: (RecentTrailRoute) -> Unit,
    onRemoveRecentRoute: (RecentTrailRoute) -> Unit,
    onSaveMessageShown: () -> Unit,
    onDestinationMessageShown: () -> Unit,
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
    var savedSegmentName by rememberSaveable { mutableStateOf(SavedSegment.Saved.name) }
    val savedSegment = SavedSegment.valueOf(savedSegmentName)
    var destinationPendingRename by remember { mutableStateOf<SavedDestination?>(null) }
    var destinationPendingDelete by remember { mutableStateOf<SavedDestination?>(null) }
    var routePendingRename by remember { mutableStateOf<SavedTrailRoute?>(null) }
    var routePendingDelete by remember { mutableStateOf<SavedTrailRoute?>(null) }
    val savedItemSnackbarHostState = remember { SnackbarHostState() }
    var statusQueue by remember { mutableStateOf(SavedItemStatusQueue()) }
    val homeScope = rememberCoroutineScope()
    var confirmClearRecents by remember { mutableStateOf(false) }

    fun removeRecentRoute(entry: RecentTrailRoute) {
        onRemoveRecentRoute(entry)
        homeScope.launch {
            savedItemSnackbarHostState.currentSnackbarData?.dismiss()
            val result = savedItemSnackbarHostState.showSnackbar(
                message = "Removed ${entry.title} from recents",
                actionLabel = "Undo",
                duration = SavedItemSnackbarSijko.undoDuration,
            )
            if (result == SnackbarResult.ActionPerformed) onRestoreRecentRoute(entry)
        }
    }
    val savedNavigationRoutes = SavedTrailRouteFilterSijko.navigationRoutes(appState.savedRoutes)
    val savedExerciseRoutes = SavedTrailRouteFilterSijko.exerciseRoutes(appState.savedRoutes)

    // Status messages show one at a time, each once, so a second never replaces the first.
    LaunchedEffect(statusQueue.current?.id) {
        val message = statusQueue.current ?: return@LaunchedEffect
        savedItemSnackbarHostState.showSnackbar(message.text, duration = SavedItemSnackbarSijko.statusDuration)
        statusQueue = statusQueue.complete(message.id)
    }

    // Sign-in results appear inside the Account sheet; with it closed they become a brief message on Home.
    LaunchedEffect(appState.accountMessage, showAccountSheet) {
        TrailAccountSheetSijko.homeMessageFor(appState.accountMessage, showAccountSheet)?.let { message ->
            onAccountMessageShown()
            statusQueue = statusQueue.enqueue(message)
        }
    }

    // Routine save and place feedback is a brief message on Home, never an OK dialog.
    LaunchedEffect(appState.saveMessage, appState.destinationMessage) {
        val saveMessage = appState.saveMessage
        val destinationMessage = appState.destinationMessage
        if (saveMessage == null && destinationMessage == null) return@LaunchedEffect
        statusQueue = statusQueue.enqueueAll(saveMessage, destinationMessage)
        if (saveMessage != null) onSaveMessageShown()
        if (destinationMessage != null) onDestinationMessageShown()
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

    var selectedTabName by rememberSaveable { mutableStateOf(TrailMapperHomeTab.Plan.name) }
    val selectedTab = TrailMapperHomeTab.valueOf(selectedTabName)

    fun selectTab(tab: TrailMapperHomeTab) {
        selectedTabName = tab.name
    }

    // Back from another top-level tab returns to Plan, the start destination, before leaving the app.
    PlatformBackHandler(
        enabled = selectedTab != TrailMapperHomeTab.Plan,
        onBack = { selectTab(TrailMapperHomeTab.Plan) },
    )

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val useNavigationRail = maxWidth >= NAVIGATION_RAIL_MIN_WIDTH
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            snackbarHost = { SnackbarHost(savedItemSnackbarHostState) },
            topBar = {
                TrailMapperTopAppBar(
                    account = appState.account,
                    isResolvingAccount = appState.isResolvingAccount,
                    onOpenAbout = onOpenAbout,
                    onOpenAccount = { showAccountSheet = true },
                )
            },
            bottomBar = {
                if (!useNavigationRail) {
                    HomeNavigationBar(selectedTab = selectedTab, onSelect = ::selectTab)
                }
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
            val topPadding = scaffoldPadding.calculateTopPadding()
            val bottomPadding = scaffoldPadding.calculateBottomPadding()
            // A rail covers the start inset itself; content then only needs its own margin.
            val contentStart = if (useNavigationRail) 20.dp else startInset + 20.dp
            val listPadding = PaddingValues(
                start = contentStart,
                top = topPadding + 16.dp,
                end = endInset + 20.dp,
                bottom = bottomPadding + 16.dp,
            )
            Row(modifier = Modifier.fillMaxSize()) {
                if (useNavigationRail) {
                    HomeNavigationRail(
                        selectedTab = selectedTab,
                        onSelect = ::selectTab,
                        modifier = Modifier.padding(start = startInset, top = topPadding, bottom = bottomPadding),
                    )
                }
                val tabModifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .consumeWindowInsets(scaffoldPadding)
                when (selectedTab) {
                    TrailMapperHomeTab.Plan -> LazyColumn(
                        modifier = tabModifier,
                        contentPadding = listPadding,
                        verticalArrangement = Arrangement.spacedBy(18.dp),
                    ) {
                        item {
                            Text(
                                text = "Plan a ride",
                                style = MaterialTheme.typography.headlineSmall,
                                color = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.semantics { heading() },
                            )
                        }
                        item {
                            PlanChoiceButton(
                                title = "Go somewhere",
                                description = "A trail route between two places",
                                icon = Icons.Filled.Place,
                                primary = true,
                                onClick = onCreateRoute,
                            )
                        }
                        item {
                            PlanChoiceButton(
                                title = "Make an exercise loop",
                                description = "Start and finish in the same place",
                                icon = Icons.Filled.Loop,
                                primary = false,
                                onClick = onCreateExerciseRoute,
                            )
                        }
                        // The three most recent routes, one tap from launch; the full list is under Saved.
                        if (appState.recentRoutes.isNotEmpty()) {
                            item {
                                RecentRoutesHeader(
                                    actionLabel = "See all",
                                    onAction = {
                                        savedSegmentName = SavedSegment.Recent.name
                                        selectTab(TrailMapperHomeTab.Saved)
                                    },
                                )
                            }
                            items(
                                items = appState.recentRoutes.take(PLAN_RECENT_ROUTE_COUNT),
                                key = { entry -> "plan-recent-${entry.id}" },
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
                            TrailInformationSection()
                        }
                        item {
                            LocalTrailGuideShortcut(onOpen = { selectTab(TrailMapperHomeTab.Updates) })
                        }
                    }

                    TrailMapperHomeTab.Saved -> LazyColumn(
                        modifier = tabModifier,
                        contentPadding = listPadding,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Text(
                                text = "Saved",
                                style = MaterialTheme.typography.headlineSmall,
                                color = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.semantics { heading() },
                            )
                        }
                        item {
                            SavedSegmentSwitch(
                                selected = savedSegment,
                                savedCount = appState.savedDestinations.size + appState.savedRoutes.size,
                                recentCount = appState.recentRoutes.size,
                                onSelect = { segment -> savedSegmentName = segment.name },
                            )
                        }
                        if (savedSegment == SavedSegment.Saved) {
                            val nothingSaved = appState.savedDestinations.isEmpty() && appState.savedRoutes.isEmpty()
                            val loading = appState.isLoadingSavedDestinations || appState.isLoadingSavedRoutes
                            if (nothingSaved && loading) {
                                item {
                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                    }
                                }
                            } else if (nothingSaved) {
                                item {
                                    EmptySavedState(
                                        onPlanRide = { selectTab(TrailMapperHomeTab.Plan) },
                                        onAddPlace = ::openAddDestinationDialog,
                                    )
                                }
                            } else {
                                item {
                                    HomeSectionHeader(
                                        title = "Places",
                                        onAdd = ::openAddDestinationDialog,
                                        addContentDescription = "Add a place",
                                    )
                                }
                                if (appState.savedDestinations.isEmpty()) {
                                    item {
                                        Text(
                                            text = "Add a place, or save a destination from a route's map.",
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                items(
                                    items = appState.savedDestinations,
                                    key = { destination -> "place-${destination.id}" },
                                ) { savedDestination ->
                                    SavedPlaceRow(
                                        place = savedDestination,
                                        navigationEnabled = trailRouteMapPresenter.isAvailable,
                                        isNavigating = appState.navigatingDestinationId == savedDestination.id,
                                        onNavigate = { onNavigateToDestination(savedDestination) },
                                        onPlanRoute = { onCreateRouteFromDestination(savedDestination) },
                                        onRename = { destinationPendingRename = savedDestination },
                                        onDelete = { destinationPendingDelete = savedDestination },
                                    )
                                }
                                listOf(
                                    "Routes" to savedNavigationRoutes,
                                    "Exercise loops" to savedExerciseRoutes,
                                ).forEach { (heading, routes) ->
                                    if (routes.isNotEmpty()) {
                                        item(key = "section-$heading") {
                                            HomeSectionHeader(title = heading)
                                        }
                                        items(
                                            items = routes,
                                            key = { savedRoute -> "route-${savedRoute.id}" },
                                        ) { savedRoute ->
                                            SavedRouteRow(
                                                savedRoute = savedRoute,
                                                openEnabled = trailRouteMapPresenter.isAvailable,
                                                sharingEnabled = trailRouteShareProvider.isAvailable,
                                                onOpen = { trailRouteMapPresenter.showTrailRoute(savedRoute.route) },
                                                onRename = { routePendingRename = savedRoute },
                                                onShare = { trailRouteShareProvider.share(savedRoute) },
                                                onDelete = { routePendingDelete = savedRoute },
                                            )
                                        }
                                    }
                                }
                            }
                        } else {
                            item {
                                Text(
                                    text = "Recent routes stay on this phone. Trail Mapper keeps up to 20 for 30 days " +
                                        "and never backs them up to your Google account.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (appState.recentRoutes.isEmpty()) {
                                item {
                                    Text(
                                        text = "Routes you plan show up here until you save them.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                }
                            } else {
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
                                item {
                                    TextButton(onClick = { confirmClearRecents = true }) {
                                        Text("Clear recents", color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                        }
                    }

                    TrailMapperHomeTab.Explore -> LazyColumn(
                        modifier = tabModifier,
                        contentPadding = listPadding,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Text(
                                text = "Explore trails",
                                style = MaterialTheme.typography.headlineSmall,
                                color = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.semantics { heading() },
                            )
                        }
                        if (trailNetworkMapPresenter.isAvailable) {
                            item {
                                TrailResourceRow(
                                    link = TrailResourceLink(
                                        title = "Trail Mapper map",
                                        url = "",
                                        description = "County trails, verified local additions and reported closure areas",
                                    ),
                                    onOpen = trailNetworkMapPresenter::showTrailNetwork,
                                    external = false,
                                )
                            }
                        }
                        resourceGroupItems(
                            groups = listOf(TrailResourceGroup.Maps, TrailResourceGroup.Community),
                            resourceLinks = resourceLinks,
                            onOpen = { link -> externalLinkOpener.open(link.url) },
                        )
                    }

                    TrailMapperHomeTab.Updates -> LocalTrailGuideContent(
                        externalLinkOpener = externalLinkOpener,
                        title = "Local updates & rules",
                        modifier = tabModifier.padding(top = topPadding),
                        horizontalPadding = PaddingValues(start = contentStart, end = endInset + 20.dp),
                        listBottomPadding = bottomPadding + 16.dp,
                    ) {
                        resourceGroupItems(
                            groups = listOf(TrailResourceGroup.Notices, TrailResourceGroup.Rules),
                            resourceLinks = resourceLinks,
                            onOpen = { link -> externalLinkOpener.open(link.url) },
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
            message = appState.accountMessage,
            onDismiss = {
                showAccountSheet = false
                onAccountMessageShown()
            },
            onSignInWithGoogle = onSignInWithGoogle,
            onSignOut = onSignOut,
            onOpenPrivacy = {
                showAccountSheet = false
                onAccountMessageShown()
                onOpenAbout()
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
            },
            onRename = { title ->
                onRenameSavedDestination(destination.id, title)
                destinationPendingRename = null
                statusQueue = statusQueue.enqueue(
                    SavedItemAccessibilityMessageSijko.renamed(
                        itemLabel = "Destination",
                        title = title,
                    )
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
            },
            onDelete = {
                onDeleteSavedDestination(destination.id)
                destinationPendingDelete = null
                statusQueue = statusQueue.enqueue(
                    SavedItemAccessibilityMessageSijko.deleted(
                        itemLabel = "Destination",
                        title = destination.title,
                    )
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
            },
            onRename = { title ->
                onRenameSavedRoute(route.id, title)
                routePendingRename = null
                statusQueue = statusQueue.enqueue(
                    SavedItemAccessibilityMessageSijko.renamed(
                        itemLabel = "Saved route",
                        title = title,
                    )
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
            },
            onDelete = {
                onDeleteSavedRoute(route.id)
                routePendingDelete = null
                statusQueue = statusQueue.enqueue(
                    SavedItemAccessibilityMessageSijko.deleted(
                        itemLabel = "Saved route",
                        title = route.title,
                    )
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
    onOpenAbout: () -> Unit,
    onOpenAccount: () -> Unit,
) {
    TopAppBar(
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
            IconButton(onClick = onOpenAbout) {
                Icon(
                    imageVector = Icons.Filled.Info,
                    contentDescription = "About Trail Mapper",
                )
            }
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
    message: String?,
    onDismiss: () -> Unit,
    onSignInWithGoogle: () -> Unit,
    onSignOut: () -> Unit,
    onOpenPrivacy: () -> Unit,
) {
    val content = TrailAccountSheetSijko.contentFor(account, isResolvingAccount, message)
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = TrailAccountSheetSijko.TITLE,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.semantics { heading() },
            )

            when (content) {
                is TrailAccountSheetContent.InProgress -> {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        Text(
                            text = content.label,
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }

                is TrailAccountSheetContent.SignedOut -> {
                    content.problem?.let { problem ->
                        Text(
                            text = problem,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        )
                    }
                    content.notice?.let { notice ->
                        Text(
                            text = notice,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        )
                    }
                    Text(
                        text = TrailAccountSheetSijko.LOCAL_DATA_NOTE,
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

                is TrailAccountSheetContent.SignedIn -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TrailAccountProfileImage(
                            account = content.account,
                            contentDescription = null,
                            modifier = Modifier.size(56.dp),
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = content.account.displayName,
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = content.account.email,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    Text(
                        text = TrailAccountSheetSijko.LOCAL_DATA_NOTE,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedButton(
                        onClick = onSignOut,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Logout,
                            contentDescription = null,
                            modifier = Modifier.padding(end = 8.dp),
                        )
                        Text("Sign out")
                    }
                }
            }

            if (content !is TrailAccountSheetContent.InProgress) {
                TextButton(
                    onClick = onOpenPrivacy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(TrailAccountSheetSijko.PRIVACY_LINK_LABEL)
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
private fun RecentRoutesHeader(
    actionLabel: String,
    onAction: () -> Unit,
) {
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
            modifier = Modifier.semantics { heading() },
        )
        TextButton(onClick = onAction) {
            Text(actionLabel)
        }
    }
}

/** One of Plan's two ways to start; the first is filled as the primary action. */
@Composable
private fun PlanChoiceButton(
    title: String,
    description: String,
    icon: ImageVector,
    primary: Boolean,
    onClick: () -> Unit,
) {
    val content: @Composable RowScope.() -> Unit = {
        Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(28.dp))
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(start = 16.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(text = title, style = MaterialTheme.typography.titleMedium)
            Text(text = description, style = MaterialTheme.typography.bodyMedium)
        }
    }
    val modifier = Modifier
        .fillMaxWidth()
        .heightIn(min = 88.dp)
    val shape = RoundedCornerShape(16.dp)
    val padding = PaddingValues(horizontal = 18.dp, vertical = 14.dp)
    if (primary) {
        Button(onClick = onClick, modifier = modifier, shape = shape, contentPadding = padding, content = content)
    } else {
        OutlinedButton(onClick = onClick, modifier = modifier, shape = shape, contentPadding = padding, content = content)
    }
}

@Composable
private fun HomeNavigationBar(
    selectedTab: TrailMapperHomeTab,
    onSelect: (TrailMapperHomeTab) -> Unit,
) {
    NavigationBar {
        TrailMapperHomeTab.entries.forEach { tab ->
            NavigationBarItem(
                selected = tab == selectedTab,
                onClick = { onSelect(tab) },
                icon = { Icon(imageVector = tab.icon(), contentDescription = null) },
                label = { Text(tab.label) },
            )
        }
    }
}

/** On wider windows the same destinations sit in a rail along the start edge. */
@Composable
private fun HomeNavigationRail(
    selectedTab: TrailMapperHomeTab,
    onSelect: (TrailMapperHomeTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    NavigationRail(modifier = modifier, containerColor = MaterialTheme.colorScheme.background) {
        TrailMapperHomeTab.entries.forEach { tab ->
            NavigationRailItem(
                selected = tab == selectedTab,
                onClick = { onSelect(tab) },
                icon = { Icon(imageVector = tab.icon(), contentDescription = null) },
                label = { Text(tab.label) },
            )
        }
    }
}

private fun TrailMapperHomeTab.icon(): ImageVector = when (this) {
    TrailMapperHomeTab.Plan -> Icons.Filled.Route
    TrailMapperHomeTab.Saved -> Icons.Filled.Bookmark
    TrailMapperHomeTab.Explore -> Icons.Filled.Map
    TrailMapperHomeTab.Updates -> Icons.Filled.Campaign
}

/** External links under group headings; each opens the browser, and says so. */
private fun LazyListScope.resourceGroupItems(
    groups: List<TrailResourceGroup>,
    resourceLinks: List<TrailResourceLink>,
    onOpen: (TrailResourceLink) -> Unit,
) {
    groups.forEach { group ->
        val links = resourceLinks.filter { link -> link.group == group }
        if (links.isEmpty()) return@forEach
        item(key = "group-${group.name}") {
            Text(
                text = group.heading,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier
                    .padding(top = 12.dp)
                    .semantics { heading() },
            )
        }
        items(items = links, key = { link -> "link-${link.url}" }) { link ->
            TrailResourceRow(link = link, onOpen = { onOpen(link) })
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

private val NAVIGATION_RAIL_MIN_WIDTH = 600.dp
private const val PLAN_RECENT_ROUTE_COUNT = 3

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
private fun TrailResourceRow(
    link: TrailResourceLink,
    onOpen: () -> Unit,
    external: Boolean = true,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClickLabel = if (external) "Open in browser" else null, onClick = onOpen),
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

/** Saved shows what was kept on purpose; Recent what was planned lately and not kept. */
private enum class SavedSegment { Saved, Recent }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SavedSegmentSwitch(
    selected: SavedSegment,
    savedCount: Int,
    recentCount: Int,
    onSelect: (SavedSegment) -> Unit,
) {
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        SavedSegment.entries.forEachIndexed { index, segment ->
            SegmentedButton(
                selected = segment == selected,
                onClick = { onSelect(segment) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = SavedSegment.entries.size),
            ) {
                Text(
                    when (segment) {
                        SavedSegment.Saved -> "Saved · $savedCount"
                        SavedSegment.Recent -> "Recent · $recentCount"
                    },
                )
            }
        }
    }
}

@Composable
private fun EmptySavedState(
    onPlanRide: () -> Unit,
    onAddPlace: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = "Nothing saved yet. Save a route from its map to keep it here.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onPlanRide) { Text("Plan a ride") }
            TextButton(onClick = onAddPlace) { Text("Add a place") }
        }
    }
}

private class SavedItemAction(
    val label: String,
    val destructive: Boolean = false,
    val onClick: () -> Unit,
)

/** Every row's secondary actions, in a labeled overflow menu instead of a hidden long press. */
@Composable
private fun SavedItemMenu(
    itemTitle: String,
    actions: List<SavedItemAction>,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(imageVector = Icons.Filled.MoreVert, contentDescription = "More actions for $itemTitle")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            actions.forEach { action ->
                DropdownMenuItem(
                    text = {
                        Text(
                            text = action.label,
                            color = if (action.destructive) MaterialTheme.colorScheme.error else Color.Unspecified,
                        )
                    },
                    onClick = {
                        expanded = false
                        action.onClick()
                    },
                )
            }
        }
    }
}

/** A saved place: tapping navigates to it from here; planning, renaming and deleting are in its menu. */
@Composable
private fun SavedPlaceRow(
    place: SavedDestination,
    navigationEnabled: Boolean,
    isNavigating: Boolean,
    onNavigate: () -> Unit,
    onPlanRoute: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        tonalElevation = 1.dp,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 64.dp)
                    .clickable(
                        enabled = navigationEnabled && !isNavigating,
                        onClickLabel = "Navigate to ${place.title}",
                        onClick = onNavigate,
                    )
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(imageVector = Icons.Filled.LocationOn, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = place.title,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "Place · ${place.address}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (isNavigating) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                }
            }
            SavedItemMenu(
                itemTitle = place.title,
                actions = listOf(
                    SavedItemAction("Plan a route here", onClick = onPlanRoute),
                    SavedItemAction("Rename", onClick = onRename),
                    SavedItemAction("Delete", destructive = true, onClick = onDelete),
                ),
            )
        }
    }
}

/** A saved route or loop: tapping opens its map; renaming, sharing and deleting are in its menu. */
@Composable
private fun SavedRouteRow(
    savedRoute: SavedTrailRoute,
    openEnabled: Boolean,
    sharingEnabled: Boolean,
    onOpen: () -> Unit,
    onRename: () -> Unit,
    onShare: () -> Unit,
    onDelete: () -> Unit,
) {
    // A caution at a glance; opening the route shows the closure and how to recalculate around it.
    val crossesClosure = remember(savedRoute.route) {
        TrailRouteClosureGateSijko.blockingAdvisories(savedRoute.route).isNotEmpty()
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        tonalElevation = 1.dp,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 64.dp)
                    .clickable(enabled = openEnabled, onClickLabel = "Open map", onClick = onOpen)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = if (savedRoute.route.kind == TrailRouteKind.ExerciseLoop) {
                        Icons.AutoMirrored.Filled.DirectionsBike
                    } else {
                        Icons.Filled.Bookmark
                    },
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = savedRoute.title,
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = SavedTrailRouteDetailSijko.detailFor(savedRoute.route),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (crossesClosure) {
                        Text(
                            text = "Reported closure on this route",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
            SavedItemMenu(
                itemTitle = savedRoute.title,
                actions = listOfNotNull(
                    SavedItemAction("Rename", onClick = onRename),
                    SavedItemAction("Share", onClick = onShare).takeIf { sharingEnabled },
                    SavedItemAction("Delete", destructive = true, onClick = onDelete),
                ),
            )
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
                    supportingText = TrailMapperAbout.PROPOSED_TRAILS_CAUTION,
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
                    supportingText = TrailMapperAbout.PROPOSED_TRAILS_CAUTION,
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
    supportingText: String? = null,
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
        Column {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
            )
            supportingText?.let { text ->
                Text(
                    text = text,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
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
