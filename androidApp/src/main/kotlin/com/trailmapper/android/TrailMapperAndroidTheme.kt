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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.core.view.WindowCompat
import com.trailmapper.shared.TrailMapperTheme
import com.trailmapper.shared.trailMapperColorScheme

/** Android-owned system bars use the same mode as shared Compose, including mode changes while open. */
@Composable
internal fun TrailMapperAndroidTheme(activity: ComponentActivity, content: @Composable () -> Unit) {
    val darkTheme = isSystemInDarkTheme()
    val background = trailMapperColorScheme(darkTheme).background
    LaunchedEffect(activity, darkTheme) {
        applyTrailMapperSystemBars(activity, darkTheme)
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
    WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
        isAppearanceLightStatusBars = !darkTheme
        isAppearanceLightNavigationBars = !darkTheme
    }
    if (Build.VERSION.SDK_INT >= 29) {
        activity.window.isNavigationBarContrastEnforced = true
        activity.window.decorView.isForceDarkAllowed = false
    }
}
