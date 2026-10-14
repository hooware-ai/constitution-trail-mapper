package com.trailmapper.android

import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
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
        val tracker = SystemBarAppearanceTracker(darkTheme, usesLightNavigationIcons(Build.VERSION.SDK_INT, darkTheme))
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
        val focusListener = ViewTreeObserver.OnWindowFocusChangeListener { hasFocus ->
            if (hasFocus) {
                // Window-manager focus handoff can reset flags after the first Compose frame.
                tracker.onWindowFocusGained()
                applyTrailMapperSystemBarAppearance(activity, darkTheme)
                view.invalidate()
            }
        }
        view.viewTreeObserver.addOnWindowFocusChangeListener(focusListener)
        view.viewTreeObserver.addOnPreDrawListener(listener)
        onDispose {
            if (view.viewTreeObserver.isAlive) {
                view.viewTreeObserver.removeOnPreDrawListener(listener)
                view.viewTreeObserver.removeOnWindowFocusChangeListener(focusListener)
            }
        }
    }
    TrailMapperTheme(darkTheme = darkTheme) {
        // Paint behind the transparent API35+ bars and consume their insets once. A map/image cannot become
        // the low-contrast backdrop of system Back/Home/Overview; child Scaffolds receive consumed insets.
        Box(Modifier.fillMaxSize().background(background)) {
            Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.displayCutout))) {
                content()
            }
            if (Build.VERSION.SDK_INT >= 35) {
                // App-owned opaque protection, outside consumed content insets and above its pixels.
                val insets = WindowInsets.navigationBars
                val density = LocalDensity.current
                val direction = LocalLayoutDirection.current
                val color = trailMapperColorScheme(true).background
                Canvas(Modifier.matchParentSize()) {
                    val edges = SystemBarInsets(insets.getLeft(density, direction), insets.getTop(density),
                        insets.getRight(density, direction), insets.getBottom(density))
                    for (rect in navigationProtectionRects(size.width, size.height, edges)) {
                        drawRect(color, Offset(rect.x, rect.y), Size(rect.width, rect.height))
                    }
                }
            }
        }
    }
}

internal fun applyTrailMapperSystemBars(activity: ComponentActivity, darkTheme: Boolean) {
    val light = trailMapperColorScheme(false).background.toArgb()
    val dark = trailMapperColorScheme(true).background.toArgb()
    val style = SystemBarStyle.auto(light, dark) { darkTheme }
    activity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = if (Build.VERSION.SDK_INT >= 35) SystemBarStyle.dark(dark) else style)
    applyTrailMapperSystemBarAppearance(activity, darkTheme)
}

private fun applyTrailMapperSystemBarAppearance(activity: ComponentActivity, darkTheme: Boolean) {
    WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
        isAppearanceLightStatusBars = !darkTheme
        isAppearanceLightNavigationBars = !usesLightNavigationIcons(Build.VERSION.SDK_INT, darkTheme)
    }
    if (Build.VERSION.SDK_INT >= 29) {
        activity.window.isNavigationBarContrastEnforced = Build.VERSION.SDK_INT < 35
        activity.window.decorView.isForceDarkAllowed = false
    }
}


internal data class SystemBarInsets(val left: Int, val top: Int, val right: Int, val bottom: Int)

/** Navigation-mode changes can reset OS flags without a theme recomposition. */
internal class SystemBarAppearanceTracker(private val darkTheme: Boolean, private val lightNavigationIcons: Boolean = darkTheme) {
    private var initialized = false
    private var previous: SystemBarInsets? = null
    private var writes = 0
    fun onWindowFocusGained() {
        initialized = false
        writes = 0
    }
    fun needsRefresh(insets: SystemBarInsets?, lightStatus: Boolean, lightNavigation: Boolean): Boolean {
        val changed = !initialized || previous != insets
        if (changed) writes = 0
        initialized = true
        previous = insets
        val drift = lightStatus == darkTheme || lightNavigation == lightNavigationIcons
        // A clean observation ends the drift episode; later resets get their own bounded budget.
        if (!changed && !drift) writes = 0
        // Bound stale API30/controller reads: never create an unbounded write/traversal loop.
        if ((changed || drift) && writes < 3) {
            writes++
            return true
        }
        return false
    }
}

/** Modern edge-to-edge navigation uses an app-painted dark inset and white system icons. */
internal fun usesLightNavigationIcons(api: Int, darkTheme: Boolean) = api >= 35 || darkTheme
internal data class NavigationProtectionRect(val x: Float, val y: Float, val width: Float, val height: Float)
internal fun navigationProtectionRects(width: Float, height: Float, insets: SystemBarInsets): List<NavigationProtectionRect> = buildList {
    val left = insets.left.toFloat().coerceIn(0f, width)
    val right = insets.right.toFloat().coerceIn(0f, width)
    val top = insets.top.toFloat().coerceIn(0f, height)
    val bottom = insets.bottom.toFloat().coerceIn(0f, height)
    if (left > 0f) add(NavigationProtectionRect(0f, 0f, left, height))
    if (right > 0f) add(NavigationProtectionRect(width - right, 0f, right, height))
    if (top > 0f) add(NavigationProtectionRect(0f, 0f, width, top))
    if (bottom > 0f) add(NavigationProtectionRect(0f, height - bottom, width, bottom))
}
