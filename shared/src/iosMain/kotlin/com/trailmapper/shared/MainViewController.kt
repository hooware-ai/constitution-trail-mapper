/**
 * Job: Create the iOS UIKit entry point that hosts the shared Compose application.
 *
 */
package com.trailmapper.shared

import androidx.compose.ui.window.ComposeUIViewController

fun MainViewController() = run {
    val currentLocationAddressProvider = IOSCurrentLocationAddressProvider()
    val mapPointSelectionProvider = IOSMapPointSelectionProvider()
    val externalLinkOpener = IOSExternalLinkOpener()
    val savedTrailRouteStore = IOSSavedTrailRouteStore()
    val savedDestinationStore = IOSSavedDestinationStore()
    val completedExerciseSessionStore = IOSCompletedExerciseSessionStore()

    ComposeUIViewController {
        App(
            currentLocationAddressProvider = currentLocationAddressProvider,
            mapPointSelectionProvider = mapPointSelectionProvider,
            externalLinkOpener = externalLinkOpener,
            savedTrailRouteStore = savedTrailRouteStore,
            savedDestinationStore = savedDestinationStore,
            completedExerciseSessionStore = completedExerciseSessionStore,
        )
    }
}
