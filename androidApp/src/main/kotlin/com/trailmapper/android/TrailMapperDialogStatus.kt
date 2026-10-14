package com.trailmapper.android

import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.Window
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat

/** Apply status appearance to the owning dialog, never its activity or navigation bar. */
@Composable
internal fun TrailMapperDialogStatusAppearance(ownerLabel: String) {
    val view = LocalView.current
    val window = findWindowOwnerInParents<Any, Window>(
        node = view,
        parentOf = { (it as? View)?.parent },
        windowOf = { (it as? DialogWindowProvider)?.window },
    )
    val appearance = dialogLightStatusOverride(Build.VERSION.SDK_INT)
    DisposableEffect(window, appearance) {
        if (window != null && appearance != null) {
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            val beforeStatus = controller.isAppearanceLightStatusBars
            val beforeNavigation = controller.isAppearanceLightNavigationBars
            controller.isAppearanceLightStatusBars = appearance
            if (BuildConfig.DEBUG) {
                Log.d("TrailMapperWindow", "t=${SystemClock.uptimeMillis()} owner=$ownerLabel " +
                    "windowId=${System.identityHashCode(window)} type=${window.attributes.type} " +
                    "statusBefore=$beforeStatus statusAfter=${controller.isAppearanceLightStatusBars} " +
                    "navBefore=$beforeNavigation navAfter=${controller.isAppearanceLightNavigationBars}")
            }
        } else if (BuildConfig.DEBUG && appearance != null) {
            Log.d("TrailMapperWindow", "t=${SystemClock.uptimeMillis()} owner=$ownerLabel noDialogWindowOwner")
        }
        // This effect owns only a disposable dialog window. Restoring flags while it closes could
        // introduce a final wrong-polarity frame; the activity's window has never been modified.
        onDispose { }
    }
}

internal fun dialogLightStatusOverride(api: Int): Boolean? =
    if (api >= 35) usesDarkStatusIcons(api, darkTheme = false) else null

/** Find the nearest real provider; an activity/context is deliberately not a fallback. */
internal fun <N, W> findWindowOwnerInParents(
    node: N?,
    parentOf: (N) -> N?,
    windowOf: (N) -> W?,
): W? {
    var current = node
    while (current != null) {
        windowOf(current)?.let { return it }
        current = parentOf(current)
    }
    return null
}
