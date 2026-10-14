package com.trailmapper.android

import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.core.view.WindowCompat
import com.trailmapper.shared.TrailMapperTheme
import com.trailmapper.shared.trailMapperColorScheme
import android.view.ViewTreeObserver
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/** Android-owned system bars use the same mode as shared Compose, including mode changes while open. */
@Composable
internal fun TrailMapperAndroidTheme(activity: ComponentActivity, content: @Composable () -> Unit) {
    val darkTheme = isSystemInDarkTheme()
    val background = trailMapperColorScheme(darkTheme).background
    SideEffect { applyTrailMapperSystemBars(activity, darkTheme) }
    DisposableEffect(activity, darkTheme) {
        val view = activity.window.decorView
        val tracker = SystemBarAppearanceTracker(darkTheme)
        val listener = ViewTreeObserver.OnPreDrawListener {
            val insets = ViewCompat.getRootWindowInsets(view)
                ?.getInsets(WindowInsetsCompat.Type.navigationBars())
            val signature = insets?.let { SystemBarInsets(it.left, it.top, it.right, it.bottom) }
            val controller = WindowCompat.getInsetsController(activity.window, view)
            if (tracker.needsRefresh(signature, controller.isAppearanceLightStatusBars,
                    controller.isAppearanceLightNavigationBars)) {
                applyTrailMapperSystemBarAppearance(activity, darkTheme)
            }
            true
        }
        view.viewTreeObserver.addOnPreDrawListener(listener)
        onDispose {
            if (view.viewTreeObserver.isAlive) view.viewTreeObserver.removeOnPreDrawListener(listener)
        }
    }
    TrailMapperTheme(darkTheme = darkTheme) {
        // Paint behind the transparent API35+ bars and consume their insets once. A map/image cannot become
        // the low-contrast backdrop of system Back/Home/Overview; child Scaffolds receive consumed insets.
        Box(Modifier.fillMaxSize().background(background).windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout))) {
            content()
        }
    }
}

internal fun applyTrailMapperSystemBars(activity: ComponentActivity, darkTheme: Boolean) {
    val light = trailMapperColorScheme(false).background.toArgb()
    val dark = trailMapperColorScheme(true).background.toArgb()
    val style = SystemBarStyle.auto(light, dark) { darkTheme }
    activity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    applyTrailMapperSystemBarAppearance(activity, darkTheme)
}

private fun applyTrailMapperSystemBarAppearance(activity: ComponentActivity, darkTheme: Boolean) {
    WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
        isAppearanceLightStatusBars = !darkTheme
        isAppearanceLightNavigationBars = !darkTheme
    }
    if (Build.VERSION.SDK_INT >= 29) {
        activity.window.isNavigationBarContrastEnforced = true
        activity.window.decorView.isForceDarkAllowed = false
    }
}


internal data class SystemBarInsets(val left: Int, val top: Int, val right: Int, val bottom: Int)

/** Navigation-mode changes can reset OS flags without a theme recomposition. */
internal class SystemBarAppearanceTracker(private val darkTheme: Boolean) {
    private var initialized = false
    private var previous: SystemBarInsets? = null
    fun needsRefresh(insets: SystemBarInsets?, lightStatus: Boolean, lightNavigation: Boolean): Boolean {
        val refresh = !initialized || previous != insets || lightStatus == darkTheme || lightNavigation == darkTheme
        initialized = true
        previous = insets
        return refresh
    }
}
