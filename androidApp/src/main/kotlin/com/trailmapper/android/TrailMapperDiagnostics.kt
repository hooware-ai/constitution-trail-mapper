package com.trailmapper.android

import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/** Debug-only geometry/window telemetry. No routes, locations, query text, account or image data. */
internal class TrailMapperWindowDiagnostic {
    private var previous: String? = null
    fun record(activity: ComponentActivity, dark: Boolean, event: String) {
        if (!BuildConfig.DEBUG) return
        val window = activity.window
        val view = window.decorView
        val insets = ViewCompat.getRootWindowInsets(view)
        val controller = WindowCompat.getInsetsController(window, view)
        val state = "activity=${activity.javaClass.simpleName} focus=${view.hasWindowFocus()} dark=$dark " +
            "bounds=${view.width}x${view.height} font=${activity.resources.configuration.fontScale} " +
            "nav=${insets?.getInsets(WindowInsetsCompat.Type.navigationBars())} " +
            "tap=${insets?.getInsets(WindowInsetsCompat.Type.tappableElement())} " +
            "ime=${insets?.getInsets(WindowInsetsCompat.Type.ime())} " +
            "lightStatus=${controller.isAppearanceLightStatusBars} lightNav=${controller.isAppearanceLightNavigationBars} " +
            "rawAppearance=${if (Build.VERSION.SDK_INT >= 30) window.insetsController?.systemBarsAppearance else null} " +
            "contrast=${if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced else null} " +
            "legacyUi=${view.systemUiVisibility} navColor=${window.navigationBarColor}"
        if (state != previous || event.startsWith("focus") || event.startsWith("snapshot")) {
            Log.d("TrailMapperWindow", "t=${SystemClock.uptimeMillis()} event=$event $state")
            previous = state
        }
    }
}
internal fun Modifier.trailMapperLayoutDiagnostic(label: String): Modifier =
    if (!BuildConfig.DEBUG) this else onGloballyPositioned { coordinates ->
        Log.d("TrailMapperLayout", "t=${SystemClock.uptimeMillis()} part=$label size=${coordinates.size} clippedWindowBounds=${coordinates.boundsInWindow()}")
    }
