/**
 * Job: Start the Android app, provide platform services to shared Compose, and bridge activity-result APIs.
 *
 */
package com.trailmapper.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModelProvider
import com.trailmapper.android.account.AndroidTrailAccountProvider
import com.trailmapper.android.debug.AndroidDeveloperOptionsActions
import com.trailmapper.android.location.AndroidAddressAutocompleteProvider
import com.trailmapper.android.location.AndroidCurrentLocationAddressProvider
import com.trailmapper.android.map.AndroidMapPointSelectionProvider
import com.trailmapper.android.map.AndroidTrailNetworkMapPresenter
import com.trailmapper.android.map.AndroidTrailRouteMapPresenter
import com.trailmapper.android.map.MapPointPickerActivity
import com.trailmapper.android.routing.AndroidAccessNetworkProvider
import com.trailmapper.android.routing.AndroidPlannerDraftStore
import com.trailmapper.android.routing.AndroidRecentTrailRouteStore
import com.trailmapper.android.routing.AndroidSavedDestinationStore
import com.trailmapper.android.routing.AndroidSavedTrailRouteStore
import com.trailmapper.android.routing.AndroidTrailNetworkProvider
import com.trailmapper.android.routing.AndroidTrailRouteShareProvider
import com.trailmapper.shared.PlannerDraftCoordinator
import com.trailmapper.shared.App
import com.trailmapper.shared.MapPointSelectionResult
import com.trailmapper.shared.sijko.ForegroundLocationGrantSijko
import com.trailmapper.shared.sijko.MapPoint

class MainActivity : ComponentActivity() {
    private val resultHostOwner = Any()
    private val activityResults by lazy {
        ViewModelProvider(this)[AndroidActivityResultViewModel::class.java]
    }

    private val locationPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        val granted = ForegroundLocationGrantSijko.isGranted(
            fineGranted = grants[Manifest.permission.ACCESS_FINE_LOCATION] == true,
            coarseGranted = grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true,
        )
        activityResults.completePermissions(granted)
    }

    private val locationSettingsLauncher = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        activityResults.completeLocationSettings(result.resultCode == RESULT_OK)
    }

    private val mapPointPickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val selectionResult = if (result.resultCode == RESULT_OK) {
            val latitude = result.data?.getDoubleExtra(MapPointPickerActivity.EXTRA_LATITUDE, Double.NaN)
                ?: Double.NaN
            val longitude = result.data?.getDoubleExtra(MapPointPickerActivity.EXTRA_LONGITUDE, Double.NaN)
                ?: Double.NaN
            val address = result.data?.getStringExtra(MapPointPickerActivity.EXTRA_ADDRESS)
            if (latitude.isFinite() && longitude.isFinite()) {
                MapPointSelectionResult.Success(
                    MapPoint(latitude = latitude, longitude = longitude),
                    address = address,
                )
            } else {
                MapPointSelectionResult.Error("The selected map point was invalid.")
            }
        } else {
            MapPointSelectionResult.Cancelled
        }
        activityResults.completeMapPoint(selectionResult)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val resultBridge = activityResults
        val appContext = applicationContext
        resultBridge.attach(
            owner = resultHostOwner,
            launchPermissions = {
                locationPermissionsLauncher.launch(
                    arrayOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                    ),
                )
            },
            launchSettings = locationSettingsLauncher::launch,
            launchMapPoint = { target ->
                mapPointPickerLauncher.launch(
                    MapPointPickerActivity.createIntent(appContext, target.label),
                )
            },
            trailAccountProvider = AndroidTrailAccountProvider(this),
        )
        val currentLocationAddressProvider = AndroidCurrentLocationAddressProvider(
            context = appContext,
            requestLocationPermission = {
                hasForegroundLocationPermission(appContext) || resultBridge.requestPermissions()
            },
            resolveLocationSettings = resultBridge::resolveLocationSettings,
        )
        val addressAutocompleteProvider = AndroidAddressAutocompleteProvider(applicationContext)
        val mapPointSelectionProvider = AndroidMapPointSelectionProvider(resultBridge::requestMapPoint)
        val trailNetworkProvider = AndroidTrailNetworkProvider(applicationContext)
        val accessNetworkProvider = AndroidAccessNetworkProvider(applicationContext)
        val trailRouteMapPresenter = AndroidTrailRouteMapPresenter(appContext)
        val trailNetworkMapPresenter = AndroidTrailNetworkMapPresenter(appContext)
        val externalLinkOpener = AndroidExternalLinkOpener(this)
        val savedTrailRouteStore = AndroidSavedTrailRouteStore(applicationContext)
        val savedDestinationStore = AndroidSavedDestinationStore(applicationContext)
        val completedExerciseSessionStore = AndroidCompletedExerciseSessionStore(applicationContext)
        val trailRouteShareProvider = AndroidTrailRouteShareProvider(applicationContext)
        val recentTrailRouteStore = AndroidRecentTrailRouteStore(applicationContext)
        // One coordinator per process, so recreating this Activity keeps the same lock and owners.
        val plannerDraftCoordinator = PlannerDraftCoordinator.forProcess { AndroidPlannerDraftStore(applicationContext) }
        val developerOptionsActions = if (BuildConfig.DEBUG) {
            AndroidDeveloperOptionsActions(this)
        } else {
            null
        }

        setContent {
            App(
                currentLocationAddressProvider = currentLocationAddressProvider,
                addressAutocompleteProvider = addressAutocompleteProvider,
                mapPointSelectionProvider = mapPointSelectionProvider,
                trailNetworkProvider = trailNetworkProvider,
                accessNetworkProvider = accessNetworkProvider,
                trailRouteMapPresenter = trailRouteMapPresenter,
                trailNetworkMapPresenter = trailNetworkMapPresenter,
                externalLinkOpener = externalLinkOpener,
                savedTrailRouteStore = savedTrailRouteStore,
                savedDestinationStore = savedDestinationStore,
                completedExerciseSessionStore = completedExerciseSessionStore,
                trailAccountProvider = resultBridge,
                trailRouteShareProvider = trailRouteShareProvider,
                recentTrailRouteStore = recentTrailRouteStore,
                plannerDraftCoordinator = plannerDraftCoordinator,
                developerOptionsActions = developerOptionsActions,
            )
        }
    }

    override fun onDestroy() {
        activityResults.detach(resultHostOwner)
        super.onDestroy()
    }
}

private fun hasForegroundLocationPermission(context: Context): Boolean {
    return ForegroundLocationGrantSijko.isGranted(
        fineGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED,
        coarseGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED,
    )
}
