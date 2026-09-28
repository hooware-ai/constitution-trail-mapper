/**
 * Job: Consume Android predictive-back events while a shared UI mode owns Back.
 *
 */
package com.trailmapper.shared

import androidx.compose.runtime.Composable
import androidx.navigationevent.NavigationEventInfo
import androidx.navigationevent.compose.NavigationBackHandler
import androidx.navigationevent.compose.rememberNavigationEventState

@Composable
internal actual fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
) {
    val state = rememberNavigationEventState(
        currentInfo = NavigationEventInfo.None,
    )
    NavigationBackHandler(
        state = state,
        isBackEnabled = enabled,
        onBackCompleted = onBack,
    )
}
